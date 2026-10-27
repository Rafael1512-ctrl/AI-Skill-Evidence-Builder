import { describe, expect, it } from 'vitest';

import type { PortfolioSummary } from '../src/providers/ai/types.js';
import type { AIProvider, AiCallResult } from '../src/providers/ai/types.js';
import type { OutboundHttpProvider } from '../src/providers/http/types.js';
import type { CreditService } from '../src/services/credit.service.js';
import type { recordAiUsage } from '../src/services/ai-usage.service.js';
import type { PricingService } from '../src/services/pricing.service.js';
import type { ScreeningRepository } from '../src/repositories/screening.repository.js';
import {
  PortfolioVerificationService,
  extractLinksFromText,
  type VerificationCandidateRow,
} from '../src/services/portfolio-verification.service.js';
import { AppError } from '../src/utils/errors.js';
import { withEnv } from './helpers/env.js';

/**
 * Evidence verification. Pure and offline: the fetcher, the AI provider, the credit service,
 * the usage recorder and the repository are all injected, so no socket, database or model is
 * involved.
 *
 * The behaviours that matter: a self-reported LinkedIn link is never scraped, a page that
 * cannot be read never costs a credit, and a cached snapshot avoids both the fetch and the
 * charge path.
 */

const CANDIDATE = {
  id: 'cand-1',
  jobId: 'job-1',
  candidateName: 'Andi Pratama',
  cvText:
    'Andi Pratama\nhttps://github.com/andi | https://www.linkedin.com/in/andi | https://andi.dev',
  job: { id: 'job-1', userId: 'user-1' },
};

interface SnapshotInput {
  id?: string | undefined;
  userId: string;
  provider: string;
  sourceUrl: string;
  status: string;
  payload: unknown;
  failureReason: string | null;
  expiresAt: Date | null;
}

function makeRepository(
  options: {
    candidate?: unknown;
    snapshots?: SnapshotInput[];
    /** The job the preflight checks ownership against; `null` simulates a missing job. */
    job?: { id: string; userId: string } | null;
    /** Candidate rows for the bulk preflight / run. */
    candidates?: VerificationCandidateRow[];
  } = {},
) {
  const snapshots: SnapshotInput[] = [...(options.snapshots ?? [])];
  const evidence: Array<{ quote: string; source: string; url: string | null }> = [];
  const statuses: string[] = [];
  let sequence = 0;
  const job = options.job === undefined ? { id: 'job-1', userId: 'user-1' } : options.job;
  // A local copy, so a test can move a candidate's state after one run without leaking into
  // the next test through the shared fixture.
  const candidates: VerificationCandidateRow[] = (options.candidates ?? []).map((candidate) => ({
    ...candidate,
  }));

  const repository = {
    async findCandidateWithJob() {
      return options.candidate === undefined ? CANDIDATE : options.candidate;
    },
    async findJobById() {
      return job;
    },
    async listCandidatesForVerification() {
      return candidates;
    },
    async findIntegrationSnapshot(input: { userId: string; provider: string; sourceUrl: string }) {
      return (
        snapshots.find(
          (snapshot) =>
            snapshot.userId === input.userId &&
            snapshot.provider === input.provider &&
            snapshot.sourceUrl === input.sourceUrl,
        ) ?? null
      );
    },
    async saveIntegrationSnapshot(input: SnapshotInput) {
      sequence += 1;
      const row = { ...input, id: input.id ?? `snap-${sequence}` };
      const existingIndex = snapshots.findIndex((snapshot) => snapshot.id === input.id);
      if (existingIndex >= 0) snapshots[existingIndex] = row;
      else snapshots.push(row);
      return row;
    },
    async addCandidateEvidence(input: { items: typeof evidence }) {
      evidence.push(...input.items);
      return input.items.length;
    },
    async clearCandidateVerificationEvidence() {
      const count = evidence.length;
      evidence.length = 0;
      return count;
    },
    async setCandidateVerificationStatus(input: { status: string }) {
      statuses.push(input.status);
    },
  } as unknown as ScreeningRepository;

  return { repository, snapshots, evidence, statuses, candidates };
}

function makeCredits(options: { available?: number } = {}) {
  const available = options.available ?? 1_000;
  const reserves: Array<Record<string, unknown>> = [];
  const settles: Array<Record<string, unknown>> = [];

  return {
    reserves,
    settles,
    available,
    service: {
      async getWallet() {
        return {
          id: 'wallet-1',
          userId: 'user-1',
          balance: available,
          reserved: 0,
          available,
          lifetimeCreditsIn: available,
          lifetimeCreditsSpent: 0,
          updatedAt: '2026-09-26T00:00:00.000Z',
        };
      },
      async reserve(input: Record<string, unknown>) {
        const quantity = (input.quantity as number | undefined) ?? 1;
        const cost = (input.credits as number | undefined) ?? quantity * 2;
        // Mirrors the real service: the atomic guard rejects the whole batch up front.
        if (cost > available) throw AppError.insufficientCredits(cost, available);
        reserves.push(input);
        return { id: `res-${reserves.length}` };
      },
      async settle(input: Record<string, unknown>) {
        settles.push(input);
        const quantity = (input.quantity as number | undefined) ?? 0;
        return { charged: quantity * 2, released: 0, alreadySettled: false };
      },
    } as unknown as CreditService,
  };
}

function makeFetcher(text: string | null) {
  const calls: string[] = [];
  const provider = {
    name: 'stub',
    async get({ url }: { url: string }) {
      calls.push(url);
      if (text === null) throw new Error('fetch failed');
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: 'text/html',
        text,
        bytes: text.length,
        truncated: false,
      };
    },
  } as unknown as OutboundHttpProvider;
  return { provider, calls };
}

function makeAiProvider(summary: Partial<PortfolioSummary> = {}) {
  const calls: string[] = [];
  const provider = {
    name: 'stub',
    model: 'stub-1',
    async analyzePortfolio({
      prompt,
    }: {
      prompt: { version: string; messages: ReadonlyArray<{ content: string }> };
    }) {
      calls.push(prompt.messages.map((message) => message.content).join('\n'));
      const data: PortfolioSummary = {
        reachable: true,
        title: 'Andi',
        summary: 'Halaman memuat proyek dan keahlian.',
        apparentSkills: [],
        projectHints: [],
        inconclusive: false,
        ...summary,
      };
      return {
        data,
        usage: {
          inputTokens: 5,
          outputTokens: 5,
          cachedTokens: 0,
          requestCount: 1,
          estimatedCostUsd: 0,
          targetRevenueUsd: 0,
          pricingKnown: true,
        },
        provider: 'stub',
        model: 'stub-1',
        promptVersion: prompt.version as AiCallResult<unknown>['promptVersion'],
        latencyMs: 1,
      };
    },
  } as unknown as AIProvider;
  return { provider, calls };
}

/** Pricing stub: the unit price the preflight and the settlement both resolve through. */
function makePricing(unitCredits = 2): PricingService {
  return {
    async resolve() {
      return unitCredits;
    },
  } as unknown as PricingService;
}

/** A fetcher that only resolves when the test releases it, to hold one verification in flight. */
function makeBlockingFetcher() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const provider = {
    name: 'blocking',
    async get({ url }: { url: string }) {
      calls.push(url);
      await gate;
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: 'text/html',
        text: 'Halaman portofolio publik.',
        bytes: 26,
        truncated: false,
      };
    },
  } as unknown as OutboundHttpProvider;
  return { provider, calls, release: () => release() };
}

function makeService(
  options: {
    candidate?: unknown;
    snapshots?: SnapshotInput[];
    pageText?: string | null;
    summary?: Partial<PortfolioSummary>;
    available?: number;
    unitCredits?: number;
    job?: { id: string; userId: string } | null;
    candidates?: VerificationCandidateRow[];
  } = {},
) {
  const repo = makeRepository({
    candidate: options.candidate,
    snapshots: options.snapshots,
    job: options.job,
    candidates: options.candidates,
  });
  const credits = makeCredits({ available: options.available });
  const fetcher = makeFetcher(
    options.pageText === undefined ? 'Halaman portofolio.' : options.pageText,
  );
  const ai = makeAiProvider(options.summary);
  const usage: Array<Record<string, unknown>> = [];
  const pricing = makePricing(options.unitCredits ?? 2);

  const service = new PortfolioVerificationService(
    repo.repository,
    credits.service,
    () => fetcher.provider,
    () => ai.provider,
    (async (input: Record<string, unknown>) => {
      usage.push(input);
    }) as unknown as typeof recordAiUsage,
    pricing,
  );

  return { service, ...repo, credits, fetcher, ai, usage };
}

describe('link extraction', () => {
  it('finds, cleans, classifies and de-duplicates the links in CV text', () => {
    const links = extractLinksFromText(
      'Lihat https://github.com/andi, https://github.com/andi dan https://www.linkedin.com/in/andi. Serta https://andi.dev/proyek',
    );

    expect(links.map((link) => link.url)).toEqual([
      'https://github.com/andi',
      'https://www.linkedin.com/in/andi',
      'https://andi.dev/proyek',
    ]);
    expect(links.map((link) => link.source)).toEqual([
      'GITHUB',
      'LINKEDIN_SELF_REPORTED',
      'PORTFOLIO',
    ]);
  });

  it('ignores non-http text and caps how many links are checked', () => {
    expect(extractLinksFromText('tidak ada tautan di sini')).toEqual([]);
    expect(
      extractLinksFromText('https://a.dev https://b.dev https://c.dev https://d.dev').map(
        (link) => link.url,
      ),
    ).toHaveLength(3);
  });
});

describe('candidate verification', () => {
  it('verifies a fetched page, stores evidence and charges one unit', async () => {
    const { service, evidence, statuses, snapshots, credits, usage, fetcher } = makeService();

    const result = await service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });

    expect(result.verificationStatus).toBe('SUPPORTED');
    expect(result.creditsCharged).toBe(2);
    expect(result.disabled).toBe(false);
    expect(result.links).toHaveLength(3);
    expect(result.links[0]).toMatchObject({
      source: 'GITHUB',
      status: 'SUPPORTED',
      fromCache: false,
    });
    expect(result.links[1]).toMatchObject({
      source: 'LINKEDIN_SELF_REPORTED',
      status: 'UNVERIFIED',
    });
    expect(result.links[2]).toMatchObject({ source: 'PORTFOLIO', status: 'SUPPORTED' });

    // LinkedIn is recorded but never fetched.
    expect(fetcher.calls).toEqual(['https://github.com/andi', 'https://andi.dev/']);

    // One hold for the candidate, settled once for one unit.
    expect(credits.reserves).toHaveLength(1);
    expect(credits.reserves[0]).toMatchObject({
      feature: 'EVIDENCE_VERIFICATION',
      referenceId: 'cand-1',
    });
    expect(credits.settles).toHaveLength(1);
    expect(credits.settles[0]).toMatchObject({ quantity: 1 });

    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({ source: 'GITHUB', url: 'https://github.com/andi' });
    expect(statuses).toEqual(['SUPPORTED']);
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual([
      'SUPPORTED',
      'UNVERIFIED',
      'SUPPORTED',
    ]);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      feature: 'EVIDENCE_VERIFICATION',
      screeningCandidateId: 'cand-1',
    });
  });

  it('releases the hold when the page cannot be fetched', async () => {
    const { service, evidence, credits, usage, statuses, snapshots } = makeService({
      pageText: null,
    });

    const result = await service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });

    expect(result.verificationStatus).toBe('UNVERIFIED');
    expect(result.creditsCharged).toBe(0);
    expect(result.links.every((link) => link.status === 'UNVERIFIED')).toBe(true);
    // Nothing was delivered, so the whole hold is released.
    expect(credits.settles[0]).toMatchObject({ quantity: 0 });
    expect(evidence).toEqual([]);
    expect(statuses).toEqual(['UNVERIFIED']);
    expect(usage).toEqual([]);
    expect(
      snapshots.find((snapshot) => snapshot.provider === 'GITHUB')?.failureReason,
    ).toBeTruthy();
  });

  it('does not charge when the page has no readable content', async () => {
    const { service, evidence, credits } = makeService({
      pageText: '',
      summary: { inconclusive: true, summary: '', title: null },
    });

    const result = await service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });

    expect(result.links[0]).toMatchObject({ status: 'UNVERIFIED', inconclusive: true });
    expect(result.creditsCharged).toBe(0);
    expect(credits.settles[0]).toMatchObject({ quantity: 0 });
    expect(evidence).toEqual([]);
  });

  it('reuses a fresh snapshot without fetching or charging', async () => {
    const { service, credits, fetcher, usage, snapshots } = makeService({
      snapshots: [
        {
          id: 'snap-cached',
          userId: 'user-1',
          provider: 'GITHUB',
          sourceUrl: 'https://github.com/andi',
          status: 'SUPPORTED',
          payload: { summary: 'Ringkasan tersimpan.' },
          failureReason: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });

    const result = await service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });

    const cached = result.links.find((link) => link.source === 'GITHUB');
    expect(cached).toMatchObject({ fromCache: true, status: 'SUPPORTED' });
    // Only the portfolio link is fetched; GitHub came from the cache.
    expect(fetcher.calls).toEqual(['https://andi.dev/']);
    expect(usage).toHaveLength(1);
    expect(credits.reserves).toHaveLength(1);
    expect(snapshots.some((snapshot) => snapshot.id === 'snap-cached')).toBe(true);
  });

  it('leaves a candidate without links NOT_CHECKED and spends nothing', async () => {
    const { service, credits, fetcher, snapshots } = makeService({
      candidate: { ...CANDIDATE, cvText: 'CV tanpa tautan apa pun.' },
    });

    const result = await service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });

    expect(result).toMatchObject({ verificationStatus: 'NOT_CHECKED', creditsCharged: 0 });
    expect(result.links).toEqual([]);
    expect(credits.reserves).toEqual([]);
    expect(fetcher.calls).toEqual([]);
    expect(snapshots).toEqual([]);
  });

  it('can be switched off by configuration', async () => {
    await withEnv({ PORTFOLIO_VERIFICATION_ENABLED: 'false' }, async () => {
      const { service, credits } = makeService();

      const result = await service.verifyCandidate({
        userId: 'user-1',
        jobId: 'job-1',
        candidateId: 'cand-1',
      });

      expect(result).toMatchObject({ disabled: true, verificationStatus: 'NOT_CHECKED' });
      expect(credits.reserves).toEqual([]);
    });
  });

  it('reports the switch in the bulk preflight and verifies nothing while it is off', async () => {
    await withEnv({ PORTFOLIO_VERIFICATION_ENABLED: 'false' }, async () => {
      const { service, credits, fetcher } = makeService({
        candidates: BULK_CANDIDATES,
        available: 100,
      });

      const estimate = await service.planVerification({ userId: 'user-1', jobId: 'job-1' });
      expect(estimate).toMatchObject({ disabled: true, eligibleCount: 2, totalCredits: 4 });

      const result = await service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' });
      expect(result).toMatchObject({ verifiedCount: 0, creditsCharged: 0, results: [] });
      expect(credits.reserves).toEqual([]);
      expect(fetcher.calls).toEqual([]);
    });
  });

  it('refuses a candidate that belongs to someone else', async () => {
    const { service } = makeService();

    await expect(
      service.verifyCandidate({ userId: 'other-user', jobId: 'job-1', candidateId: 'cand-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      service.verifyCandidate({ userId: 'user-1', jobId: 'other-job', candidateId: 'cand-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not charge again when the same candidate is replayed from a fresh snapshot', async () => {
    const cachedOnly = {
      ...CANDIDATE,
      cvText: 'Andi Pratama\nhttps://github.com/andi',
    };
    const { service, credits, fetcher, usage } = makeService({
      candidate: cachedOnly,
      snapshots: [
        {
          id: 'snap-cached',
          userId: 'user-1',
          provider: 'GITHUB',
          sourceUrl: 'https://github.com/andi',
          status: 'SUPPORTED',
          payload: { summary: 'Ringkasan tersimpan.' },
          failureReason: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });

    const result = await service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });

    // The hold is still taken and settled, but for zero units: nothing was fetched this time.
    expect(result.creditsCharged).toBe(0);
    expect(result.verificationStatus).toBe('SUPPORTED');
    expect(fetcher.calls).toEqual([]);
    expect(usage).toEqual([]);
    expect(credits.settles[0]).toMatchObject({ quantity: 0 });
  });

  it('rejects a second concurrent verification of the same candidate', async () => {
    const repo = makeRepository();
    const credits = makeCredits();
    const fetcher = makeBlockingFetcher();
    const ai = makeAiProvider();
    const service = new PortfolioVerificationService(
      repo.repository,
      credits.service,
      () => fetcher.provider,
      () => ai.provider,
      (async () => {}) as unknown as typeof recordAiUsage,
      makePricing(2),
    );

    const first = service.verifyCandidate({
      userId: 'user-1',
      jobId: 'job-1',
      candidateId: 'cand-1',
    });
    // Let the first request reach the fetch (and hold the per-candidate lock).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.calls).toHaveLength(1);

    await expect(
      service.verifyCandidate({ userId: 'user-1', jobId: 'job-1', candidateId: 'cand-1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    fetcher.release();
    await expect(first).resolves.toMatchObject({ verificationStatus: 'SUPPORTED' });
    // The rejected attempt never reserved, so exactly one hold exists.
    expect(credits.reserves).toHaveLength(1);
  });
});

const BULK_CANDIDATES: VerificationCandidateRow[] = [
  {
    id: 'cand-1',
    candidateName: 'Andi',
    cvText: 'CV Andi\nhttps://github.com/andi',
    state: 'COMPLETED',
    verificationStatus: 'NOT_CHECKED',
  },
  {
    id: 'cand-2',
    candidateName: 'Budi',
    cvText: 'CV Budi\nhttps://github.com/budi',
    state: 'COMPLETED',
    verificationStatus: 'NOT_CHECKED',
  },
  {
    id: 'cand-3',
    candidateName: 'Citra',
    cvText: 'CV Citra tanpa tautan apa pun.',
    state: 'COMPLETED',
    verificationStatus: 'NOT_CHECKED',
  },
  {
    id: 'cand-4',
    candidateName: 'Dewi',
    cvText: 'CV Dewi\nhttps://github.com/dewi',
    state: 'PROCESSING',
    verificationStatus: 'NOT_CHECKED',
  },
  {
    id: 'cand-5',
    candidateName: 'Eka',
    cvText: 'CV Eka\nhttps://github.com/eka',
    state: 'COMPLETED',
    verificationStatus: 'SUPPORTED',
  },
];

describe('bulk verification preflight', () => {
  it('counts only the eligible candidates and prices the total from the pricing service', async () => {
    const { service } = makeService({
      candidates: BULK_CANDIDATES,
      available: 100,
      unitCredits: 2,
    });

    const estimate = await service.planVerification({ userId: 'user-1', jobId: 'job-1' });

    expect(estimate).toMatchObject({
      feature: 'EVIDENCE_VERIFICATION',
      unitCredits: 2,
      eligibleCount: 2,
      totalCredits: 4,
      alreadyVerifiedCount: 1,
      inProgressCount: 1,
      noLinkCount: 1,
      balance: 100,
      available: 100,
      sufficient: true,
      shortfall: 0,
    });
    expect(estimate.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'cand-1',
      'cand-2',
    ]);
  });

  it('reports a shortfall when the balance cannot cover the batch', async () => {
    const { service } = makeService({ candidates: BULK_CANDIDATES, available: 3, unitCredits: 2 });

    const estimate = await service.planVerification({ userId: 'user-1', jobId: 'job-1' });

    expect(estimate).toMatchObject({
      eligibleCount: 2,
      totalCredits: 4,
      sufficient: false,
      shortfall: 1,
    });
  });

  it('hides a job that belongs to someone else or does not exist', async () => {
    const otherUser = makeService({
      candidates: BULK_CANDIDATES,
      job: { id: 'job-1', userId: 'user-2' },
    });
    await expect(
      otherUser.service.planVerification({ userId: 'user-1', jobId: 'job-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const missing = makeService({ candidates: BULK_CANDIDATES, job: null });
    await expect(
      missing.service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('bulk verification run', () => {
  it('verifies only the eligible candidates and settles one hold for the batch', async () => {
    const { service, credits, fetcher, statuses, usage } = makeService({
      candidates: BULK_CANDIDATES,
      available: 100,
      unitCredits: 2,
    });

    const result = await service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' });

    expect(result).toMatchObject({
      jobId: 'job-1',
      unitCredits: 2,
      eligibleCount: 2,
      verifiedCount: 2,
      creditsCharged: 4,
    });
    expect(result.results.map((entry) => entry.candidateId)).toEqual(['cand-1', 'cand-2']);
    // Only the two fetchable, completed, not-yet-verified candidates were fetched.
    expect(fetcher.calls).toEqual(['https://github.com/andi', 'https://github.com/budi']);
    expect(usage).toHaveLength(2);
    expect(statuses).toEqual(['SUPPORTED', 'SUPPORTED']);

    // One hold for the whole batch, reserved for both candidates, settled once for both units.
    expect(credits.reserves).toHaveLength(1);
    expect(credits.reserves[0]).toMatchObject({
      feature: 'EVIDENCE_VERIFICATION',
      quantity: 2,
      referenceType: 'screening_job',
      referenceId: 'job-1',
    });
    expect(credits.settles).toHaveLength(1);
    expect(credits.settles[0]).toMatchObject({ quantity: 2 });
  });

  it('refuses an unaffordable batch without reserving, fetching or verifying anything', async () => {
    const { service, credits, fetcher, statuses } = makeService({
      candidates: BULK_CANDIDATES,
      available: 3,
      unitCredits: 2,
    });

    await expect(
      service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });

    expect(credits.reserves).toEqual([]);
    expect(credits.settles).toEqual([]);
    expect(fetcher.calls).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it('does not charge twice when the bulk action is replayed', async () => {
    const { service, credits, fetcher, candidates } = makeService({
      candidates: BULK_CANDIDATES,
      available: 100,
    });

    const first = await service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' });
    expect(first.creditsCharged).toBe(4);

    // The stored rows now reflect the run, so the replayed request has nothing left to verify.
    for (const candidate of candidates) {
      if (candidate.id === 'cand-1' || candidate.id === 'cand-2') {
        candidate.verificationStatus = 'SUPPORTED';
      }
    }

    const replay = await service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' });

    expect(replay).toMatchObject({ eligibleCount: 0, verifiedCount: 0, creditsCharged: 0 });
    // Only the first run reserved, settled and fetched - the replay was a pure no-op.
    expect(credits.reserves).toHaveLength(1);
    expect(credits.settles).toHaveLength(1);
    expect(fetcher.calls).toHaveLength(2);
  });

  it('never charges twice for an already-verified candidate', async () => {
    const verifiedOnly = BULK_CANDIDATES.map((candidate) => ({
      ...candidate,
      verificationStatus: 'SUPPORTED' as const,
    }));
    const { service, credits, fetcher } = makeService({
      candidates: verifiedOnly,
      available: 100,
    });

    const result = await service.verifyCandidates({ userId: 'user-1', jobId: 'job-1' });

    expect(result).toMatchObject({ eligibleCount: 0, verifiedCount: 0, creditsCharged: 0 });
    expect(result.results).toEqual([]);
    expect(credits.reserves).toEqual([]);
    expect(fetcher.calls).toEqual([]);
  });
});
