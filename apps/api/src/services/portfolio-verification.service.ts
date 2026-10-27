import {
  LIMITS,
  type BulkVerificationResult,
  type CandidateVerificationResult,
  type LinkVerification,
  type ScreeningCandidateState,
  type ScreeningVerificationEstimate,
  type VerificationStatus,
} from '@aseb/shared';

import { env } from '../config/env.js';
import { getAiProvider, type AIProvider } from '../providers/ai/index.js';
import { getOutboundHttpProvider, type OutboundHttpProvider } from '../providers/http/index.js';
import {
  HRD_PORTFOLIO_VERIFICATION_PROMPT_VERSION,
  buildHrdPortfolioVerificationPrompt,
  type PortfolioSourceKind,
} from '../prompts/hrd/portfolioVerificationPrompt.js';
import { ScreeningRepository } from '../repositories/screening.repository.js';
import { AppError } from '../utils/errors.js';
import { truncate } from '../utils/text.js';
import { recordAiUsage } from './ai-usage.service.js';
import { creditService, type CreditService } from './credit.service.js';
import { pricingService, type PricingService } from './pricing.service.js';

/** Total links checked per candidate; a CV with twenty links must not cost twenty calls. */
const MAX_LINKS_PER_CANDIDATE = 3;
/** Snapshots are reused for a day: a portfolio rarely changes between batches. */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;

const VERIFICATION_FEATURE = 'EVIDENCE_VERIFICATION';

export interface ExtractedLink {
  url: string;
  source: PortfolioSourceKind;
}

/**
 * Pulls the http(s) links out of stored CV text.
 *
 * Pure and offline. Trailing punctuation is trimmed, duplicates are dropped, and LinkedIn is
 * classified as self-reported because it is never fetched - the product records the claim
 * without pretending it verified a profile it did not open.
 */
export function extractLinksFromText(text: string, max = MAX_LINKS_PER_CANDIDATE): ExtractedLink[] {
  const matches = text.match(/https?:\/\/[^\s<>()"'`]+/gi) ?? [];
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];

  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:)\]}>]+$/, '');
    let url: URL;
    try {
      url = new URL(cleaned);
    } catch {
      continue;
    }

    const normalised = url.toString();
    if (seen.has(normalised)) continue;
    seen.add(normalised);

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const source: PortfolioSourceKind =
      host === 'github.com' || host.endsWith('.github.io')
        ? 'GITHUB'
        : host === 'linkedin.com' || host.endsWith('.linkedin.com')
          ? 'LINKEDIN_SELF_REPORTED'
          : 'PORTFOLIO';

    links.push({ url: normalised, source });
    if (links.length >= max) break;
  }

  return links;
}

export interface VerifyCandidateInput {
  userId: string;
  jobId: string;
  candidateId: string;
}

export interface PlanVerificationInput {
  userId: string;
  jobId: string;
}

/** The candidate fields the verifier needs. The full row never leaves the server. */
export interface VerificationCandidateRow {
  id: string;
  candidateName: string;
  cvText: string | null;
  state: ScreeningCandidateState;
  verificationStatus: VerificationStatus;
}

interface VerificationPartition {
  eligible: VerificationCandidateRow[];
  alreadyVerifiedCount: number;
  inProgressCount: number;
  noLinkCount: number;
}

/** True when a CV exposes at least one link the server can actually fetch and summarise. */
function hasFetchableLink(cvText: string | null): boolean {
  return extractLinksFromText(cvText ?? '').some(
    (link) => link.source !== 'LINKEDIN_SELF_REPORTED',
  );
}

/**
 * Evidence verification for screening candidates (Phase 16).
 *
 * For every link a CV contains: reuse a fresh snapshot, otherwise fetch it through the SSRF
 * guards and summarise the page through the AI boundary. `EVIDENCE_VERIFICATION` is priced per
 * CV, so one hold covers all of a candidate's links and is settled once, for one unit, only
 * when a page was actually fetched and summarised - a cache hit, an unreachable page or a CV
 * with nothing fetchable never charges.
 *
 * Credit safety: the hold is taken before the first fetch (individual) or once for the whole
 * batch before any fetch (bulk), and a candidate is only ever submitted to one verification at
 * a time, so a retried or concurrent request cannot double-charge or duplicate the work.
 *
 * The statuses stay non-accusatory: `SUPPORTED` means "the page exists and says this", and
 * everything else stays `UNVERIFIED`. Cross-checking a specific CV claim against a page
 * (which would justify `CONFLICTING_INFORMATION`) is deliberately not done here.
 */
export class PortfolioVerificationService {
  /** Candidate ids currently being verified in this process; a guard against duplicate work. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repository = new ScreeningRepository(),
    private readonly credits: CreditService = creditService,
    private readonly fetcher: () => OutboundHttpProvider = getOutboundHttpProvider,
    private readonly provider: () => AIProvider = getAiProvider,
    private readonly usage: typeof recordAiUsage = recordAiUsage,
    private readonly pricing: PricingService = pricingService,
  ) {}

  async verifyCandidate(input: VerifyCandidateInput): Promise<CandidateVerificationResult> {
    const candidate = await this.repository.findCandidateWithJob(input.candidateId);
    if (!candidate || candidate.job.userId !== input.userId || candidate.jobId !== input.jobId) {
      throw AppError.notFound('Kandidat tidak ditemukan pada sesi screening ini.');
    }

    if (!env.PORTFOLIO_VERIFICATION_ENABLED) {
      return {
        candidateId: candidate.id,
        verificationStatus: 'NOT_CHECKED',
        links: [],
        creditsCharged: 0,
        disabled: true,
      };
    }

    const links = extractLinksFromText(candidate.cvText ?? '');
    if (links.length === 0) {
      // No link to check is not a negative finding, so the status stays NOT_CHECKED.
      await this.repository.clearCandidateVerificationEvidence(candidate.id);
      await this.repository.setCandidateVerificationStatus({
        candidateId: candidate.id,
        status: 'NOT_CHECKED',
      });
      return {
        candidateId: candidate.id,
        verificationStatus: 'NOT_CHECKED',
        links: [],
        creditsCharged: 0,
        disabled: false,
      };
    }

    // The lock is taken before the hold so a rejected concurrent request never leaves one behind.
    return this.withCandidateLock(candidate.id, async () => {
      const chargeable = links.some((link) => link.source !== 'LINKEDIN_SELF_REPORTED');
      const reservation = chargeable
        ? await this.credits.reserve({
            userId: input.userId,
            feature: VERIFICATION_FEATURE,
            referenceType: 'screening_candidate',
            referenceId: candidate.id,
          })
        : null;

      const outcome = await this.runVerification({
        candidate,
        links,
        userId: input.userId,
      });

      // Settle for exactly one unit when a page was freshly fetched and summarised; a fresh
      // snapshot, an unreachable link or nothing to fetch releases the hold instead.
      const settlement = reservation
        ? await this.credits.settle({
            reservationId: reservation.id,
            quantity: outcome.billable ? 1 : 0,
            description: outcome.billable
              ? `Verifikasi bukti untuk kandidat ${candidate.candidateName}`
              : `Verifikasi bukti tanpa tagihan untuk kandidat ${candidate.candidateName}`,
            idempotencyKey: `evidence_verification:${reservation.id}`,
          })
        : { charged: 0 };

      return { ...outcome.result, creditsCharged: settlement.charged };
    });
  }

  /**
   * Preflight for the bulk action: who would be verified and what the total would cost.
   *
   * Called before any credit is spent, so the recruiter sees the price and the candidate count
   * before confirming. It reads the same eligibility rule the bulk run uses, so the estimate
   * cannot drift from what is actually charged.
   */
  async planVerification(input: PlanVerificationInput): Promise<ScreeningVerificationEstimate> {
    await this.requireOwnedJob(input.userId, input.jobId);
    const candidates = await this.repository.listCandidatesForVerification(input.jobId);
    return this.buildEstimate(input.userId, this.partitionCandidates(candidates));
  }

  /**
   * Verifies every eligible candidate of a job in one request.
   *
   * All-or-nothing preflight: the whole hold (`unitCredits x eligibleCount`) is reserved before
   * any page is fetched, so an unaffordable batch never starts partially. The hold is settled
   * once for the candidates whose page was genuinely fetched and summarised, and the remainder
   * is released in the same atomic settlement.
   *
   * Duplicate protection: candidates already `SUPPORTED` are not eligible, a candidate currently
   * in flight is skipped rather than queued twice, and the settlement is keyed by the reservation
   * so a replayed request cannot charge twice.
   */
  async verifyCandidates(input: PlanVerificationInput): Promise<BulkVerificationResult> {
    await this.requireOwnedJob(input.userId, input.jobId);
    const partition = this.partitionCandidates(
      await this.repository.listCandidatesForVerification(input.jobId),
    );
    const estimate = await this.buildEstimate(input.userId, partition);

    if (!env.PORTFOLIO_VERIFICATION_ENABLED || estimate.eligibleCount === 0) {
      return this.emptyBulkResult(input.jobId, estimate.unitCredits, estimate.eligibleCount);
    }

    const reservation = await this.credits.reserve({
      userId: input.userId,
      feature: VERIFICATION_FEATURE,
      quantity: estimate.eligibleCount,
      referenceType: 'screening_job',
      referenceId: input.jobId,
    });

    const results: CandidateVerificationResult[] = [];
    let verifiedCount = 0;

    for (const candidate of partition.eligible) {
      // Already being verified by another request: skip instead of creating a second job.
      if (this.inFlight.has(candidate.id)) continue;

      const links = extractLinksFromText(candidate.cvText ?? '');
      if (links.length === 0) continue;

      const outcome = await this.withCandidateLock(candidate.id, () =>
        this.runVerification({ candidate, links, userId: input.userId }),
      );
      if (outcome.billable) verifiedCount += 1;
      results.push(outcome.result);
    }

    const settlement = await this.credits.settle({
      reservationId: reservation.id,
      quantity: verifiedCount,
      description: `Verifikasi bukti untuk ${verifiedCount} dari ${estimate.eligibleCount} kandidat`,
      idempotencyKey: `evidence_verification_bulk:${reservation.id}`,
    });

    return {
      jobId: input.jobId,
      feature: VERIFICATION_FEATURE,
      unitCredits: estimate.unitCredits,
      eligibleCount: estimate.eligibleCount,
      verifiedCount,
      creditsCharged: settlement.charged,
      results,
    };
  }

  /** Fetches, summarises and stores the links of one candidate. Performs no credit movement. */
  private async runVerification(input: {
    candidate: { id: string; candidateName: string };
    links: ExtractedLink[];
    userId: string;
  }): Promise<{ result: CandidateVerificationResult; billable: boolean }> {
    const results: LinkVerification[] = [];
    const evidenceItems: Array<{
      quote: string;
      source: 'GITHUB' | 'PORTFOLIO';
      url: string | null;
      note: string | null;
    }> = [];
    let billable = false;

    for (const link of input.links) {
      const outcome = await this.verifyLink({
        userId: input.userId,
        candidateId: input.candidate.id,
        link,
      });
      results.push(outcome.result);
      if (outcome.freshlyFetched) billable = true;
      if (outcome.evidence) evidenceItems.push(outcome.evidence);
    }

    await this.repository.clearCandidateVerificationEvidence(input.candidate.id);
    await this.repository.addCandidateEvidence({
      candidateId: input.candidate.id,
      items: evidenceItems,
    });

    const verificationStatus: VerificationStatus = results.some(
      (result) => result.status === 'SUPPORTED',
    )
      ? 'SUPPORTED'
      : 'UNVERIFIED';

    await this.repository.setCandidateVerificationStatus({
      candidateId: input.candidate.id,
      status: verificationStatus,
    });

    return {
      result: {
        candidateId: input.candidate.id,
        verificationStatus,
        links: results,
        creditsCharged: 0,
        disabled: false,
      },
      billable,
    };
  }

  private async requireOwnedJob(userId: string, jobId: string): Promise<void> {
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }
  }

  /**
   * Splits a job's candidates into the ones a bulk run would charge for and the reasons the
   * rest are excluded. `eligible` keeps the results order, so the screen's ranking is untouched.
   */
  private partitionCandidates(
    candidates: ReadonlyArray<VerificationCandidateRow>,
  ): VerificationPartition {
    const eligible: VerificationCandidateRow[] = [];
    let alreadyVerifiedCount = 0;
    let inProgressCount = 0;
    let noLinkCount = 0;

    for (const candidate of candidates) {
      if (candidate.state !== 'COMPLETED') {
        inProgressCount += 1;
        continue;
      }
      if (candidate.verificationStatus === 'SUPPORTED') {
        alreadyVerifiedCount += 1;
        continue;
      }
      if (!hasFetchableLink(candidate.cvText)) {
        noLinkCount += 1;
        continue;
      }
      eligible.push(candidate);
    }

    return { eligible, alreadyVerifiedCount, inProgressCount, noLinkCount };
  }

  private async buildEstimate(
    userId: string,
    partition: VerificationPartition,
  ): Promise<ScreeningVerificationEstimate> {
    const unitCredits = await this.pricing.resolve(VERIFICATION_FEATURE);
    const wallet = await this.credits.getWallet(userId);
    const available = wallet.balance - wallet.reserved;
    const totalCredits = unitCredits * partition.eligible.length;

    return {
      feature: VERIFICATION_FEATURE,
      disabled: !env.PORTFOLIO_VERIFICATION_ENABLED,
      unitCredits,
      eligibleCount: partition.eligible.length,
      totalCredits,
      alreadyVerifiedCount: partition.alreadyVerifiedCount,
      inProgressCount: partition.inProgressCount,
      noLinkCount: partition.noLinkCount,
      balance: wallet.balance,
      reserved: wallet.reserved,
      available,
      sufficient: totalCredits <= available,
      shortfall: Math.max(0, totalCredits - available),
      candidates: partition.eligible.map((candidate) => ({
        candidateId: candidate.id,
        candidateName: candidate.candidateName,
      })),
    };
  }

  private emptyBulkResult(
    jobId: string,
    unitCredits: number,
    eligibleCount: number,
  ): BulkVerificationResult {
    return {
      jobId,
      feature: VERIFICATION_FEATURE,
      unitCredits,
      eligibleCount,
      verifiedCount: 0,
      creditsCharged: 0,
      results: [],
    };
  }

  /** Serialises verification per candidate: a second concurrent request is rejected, not queued. */
  private async withCandidateLock<T>(candidateId: string, run: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(candidateId)) {
      throw AppError.conflict('Verifikasi kandidat ini sedang berjalan.');
    }
    this.inFlight.add(candidateId);
    try {
      return await run();
    } finally {
      this.inFlight.delete(candidateId);
    }
  }

  private async verifyLink(input: {
    userId: string;
    candidateId: string;
    link: ExtractedLink;
  }): Promise<{
    result: LinkVerification;
    /**
     * True only when this link produced a freshly fetched, summarised page. A cached snapshot
     * and a self-reported LinkedIn link are both false, so neither can trigger a charge.
     */
    freshlyFetched: boolean;
    evidence: {
      quote: string;
      source: 'GITHUB' | 'PORTFOLIO';
      url: string | null;
      note: string | null;
    } | null;
  }> {
    const { link } = input;
    const providerName = link.source === 'GITHUB' ? 'GITHUB' : 'PORTFOLIO';

    // LinkedIn is never fetched: the profile is recorded as a self-reported claim only.
    if (link.source === 'LINKEDIN_SELF_REPORTED') {
      const snapshot = await this.repository.findIntegrationSnapshot({
        userId: input.userId,
        provider: 'LINKEDIN',
        sourceUrl: link.url,
      });
      await this.repository.saveIntegrationSnapshot({
        userId: input.userId,
        provider: 'LINKEDIN',
        sourceUrl: link.url,
        status: 'UNVERIFIED',
        payload: { note: 'Hanya dilaporkan sendiri; halaman tidak diambil.' },
        failureReason: null,
        expiresAt: null,
        existingId: snapshot?.id,
      });

      return {
        result: {
          url: link.url,
          source: 'LINKEDIN_SELF_REPORTED',
          status: 'UNVERIFIED',
          summary: '',
          inconclusive: false,
          fromCache: false,
          failureReason: null,
        },
        freshlyFetched: false,
        evidence: null,
      };
    }

    const cached = await this.repository.findIntegrationSnapshot({
      userId: input.userId,
      provider: providerName,
      sourceUrl: link.url,
    });

    const cacheFresh =
      cached !== null &&
      cached.expiresAt !== null &&
      cached.expiresAt.getTime() > Date.now() &&
      cached.status !== 'UNVERIFIED';

    if (cacheFresh && cached) {
      const payload = (cached.payload ?? {}) as {
        summary?: string;
        inconclusive?: boolean;
      };
      return {
        result: {
          url: link.url,
          source: providerName,
          status: cached.status,
          summary: payload.summary ?? '',
          inconclusive: payload.inconclusive ?? false,
          fromCache: true,
          failureReason: cached.failureReason,
        },
        // A cached snapshot reused a page that was fetched earlier, so this run costs nothing.
        freshlyFetched: false,
        evidence: this.toEvidence(link, providerName, payload.summary ?? ''),
      };
    }

    try {
      const page = await this.fetcher().get({ url: link.url });
      const prompt = buildHrdPortfolioVerificationPrompt({
        url: link.url,
        source: link.source,
        pageText: page.text,
      });
      const analysis = await this.provider().analyzePortfolio({ prompt });

      const status: VerificationStatus = analysis.data.inconclusive ? 'UNVERIFIED' : 'SUPPORTED';

      await this.repository.saveIntegrationSnapshot({
        userId: input.userId,
        provider: providerName,
        sourceUrl: link.url,
        status,
        payload: {
          title: analysis.data.title,
          summary: analysis.data.summary,
          apparentSkills: analysis.data.apparentSkills,
          projectHints: analysis.data.projectHints,
          inconclusive: analysis.data.inconclusive,
          truncated: page.truncated,
        },
        failureReason: null,
        expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
        existingId: cached?.id,
      });

      await this.usage({
        userId: input.userId,
        feature: VERIFICATION_FEATURE,
        result: analysis,
        screeningCandidateId: input.candidateId,
      });

      return {
        result: {
          url: link.url,
          source: providerName,
          status,
          summary: analysis.data.summary,
          inconclusive: analysis.data.inconclusive,
          fromCache: false,
          failureReason: null,
        },
        freshlyFetched: status === 'SUPPORTED',
        evidence: this.toEvidence(link, providerName, analysis.data.summary),
      };
    } catch (error) {
      const reason =
        error instanceof AppError ? error.message : 'Halaman tidak dapat diverifikasi.';
      const failureReason = truncate(reason, 300).text;

      await this.repository.saveIntegrationSnapshot({
        userId: input.userId,
        provider: providerName,
        sourceUrl: link.url,
        status: 'UNVERIFIED',
        payload: null,
        failureReason,
        expiresAt: null,
        existingId: cached?.id,
      });

      return {
        result: {
          url: link.url,
          source: providerName,
          status: 'UNVERIFIED',
          summary: '',
          inconclusive: false,
          fromCache: false,
          failureReason,
        },
        freshlyFetched: false,
        evidence: null,
      };
    }
  }

  private toEvidence(
    link: ExtractedLink,
    source: 'GITHUB' | 'PORTFOLIO',
    summary: string,
  ): {
    quote: string;
    source: 'GITHUB' | 'PORTFOLIO';
    url: string | null;
    note: string | null;
  } | null {
    const quote = truncate(
      summary.replace(/\s+/g, ' ').trim(),
      LIMITS.MAX_EVIDENCE_QUOTE_CHARS,
    ).text;
    if (quote.length === 0) return null;
    return { quote, source, url: link.url, note: 'Ringkasan halaman publik yang diambil sistem.' };
  }
}

export const portfolioVerificationService = new PortfolioVerificationService();

/** The prompt version this service records, exported for tests and docs. */
export const PORTFOLIO_VERIFICATION_PROMPT_VERSION = HRD_PORTFOLIO_VERIFICATION_PROMPT_VERSION;
