import { createHash } from 'node:crypto';

import {
  LIMITS,
  cvAuditResultSchema,
  type CvAuditJob,
  type CvAuditUsage,
  type FeatureKey,
} from '@aseb/shared';

import { getCvProcessingQueue } from '../queues/cv-processing.queue.js';
import { CvRepository, type CvAuditJobWithRelations } from '../repositories/cv.repository.js';
import { getAiProvider } from '../providers/ai/index.js';
import { buildJobSeekerAuditPrompt } from '../prompts/jobSeeker/auditPrompt.js';
import { AppError, isAppError } from '../utils/errors.js';
import { validatePdfUpload } from '../utils/file-validation.js';
import { recordAiUsage } from './ai-usage.service.js';
import { creditService, type CreditService } from './credit.service.js';
import { extractPdfTextOrThrow } from './pdf-extraction.service.js';
import { pricingService, type PricingService } from './pricing.service.js';

const FREE_AUDIT_FEATURE: FeatureKey = 'FREE_CV_AUDIT';
const PAID_AUDIT_FEATURE: FeatureKey = 'CV_DEEP_ANALYSIS';
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface AuditCvInput {
  file: {
    originalname?: string | undefined;
    mimetype?: string | undefined;
    size: number;
    buffer: Buffer;
  };
  userId: string;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface AuditDayWindow {
  from: Date;
  to: Date;
  dateKey: string;
  resetsAt: string;
}

/**
 * The free quota resets at midnight in Jakarta (WIB), independent of the server's timezone.
 * Indonesia has no daylight-saving transition, so a fixed UTC+7 offset is exact.
 */
export function auditDayWindow(now = new Date()): AuditDayWindow {
  const jakartaNow = now.getTime() + JAKARTA_OFFSET_MS;
  const localStart = Math.floor(jakartaNow / DAY_MS) * DAY_MS;
  const from = new Date(localStart - JAKARTA_OFFSET_MS);
  const to = new Date(from.getTime() + DAY_MS);

  return {
    from,
    to,
    dateKey: new Date(localStart).toISOString().slice(0, 10),
    resetsAt: to.toISOString(),
  };
}

interface AuditGrant {
  mode: 'FREE' | 'PAID';
  reservationId: string;
  freeAuditsUsed: number;
  unitCredits: number;
  paidAuditCredits: number;
  window: AuditDayWindow;
}

function failureFor(error: unknown): { code: string; message: string } {
  if (isAppError(error)) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Audit CV gagal diproses. Silakan coba lagi.',
  };
}

/**
 * The free CV audit is split across two phases:
 *
 * 1. `submit` validates/extracts the PDF, claims the daily quota and persists a durable
 *    `CvAuditJob` before enqueueing it.
 * 2. `processAudit` runs in the background worker, calls the provider, settles credits
 *    and stores the analysis.
 *
 * A browser refresh can therefore reconnect to the same job through `getJob`; it no longer
 * owns the only copy of the operation's progress.
 */
export class CvAuditService {
  constructor(
    private readonly repository = new CvRepository(),
    private readonly credits: CreditService = creditService,
    private readonly pricing: PricingService = pricingService,
  ) {}

  private async freeAuditsUsed(userId: string, window: AuditDayWindow): Promise<number> {
    const count = await this.credits.countReservationsInWindow({
      userId,
      feature: FREE_AUDIT_FEATURE,
      from: window.from,
      to: window.to,
    });
    return Math.min(count, LIMITS.FREE_CV_AUDITS_PER_DAY);
  }

  async getUsage(userId: string): Promise<CvAuditUsage> {
    const window = auditDayWindow();
    const [freeAuditsUsed, paidEstimate] = await Promise.all([
      this.freeAuditsUsed(userId, window),
      this.credits.estimate(userId, PAID_AUDIT_FEATURE),
    ]);

    return {
      freeAuditsLimit: LIMITS.FREE_CV_AUDITS_PER_DAY,
      freeAuditsUsed,
      freeAuditsRemaining: LIMITS.FREE_CV_AUDITS_PER_DAY - freeAuditsUsed,
      resetsAt: window.resetsAt,
      paidAuditCredits: paidEstimate.unitCredits,
      availableCredits: paidEstimate.available,
    };
  }

  private async claimQuota(userId: string): Promise<AuditGrant> {
    const window = auditDayWindow();
    const usedBefore = await this.freeAuditsUsed(userId, window);

    if (usedBefore < LIMITS.FREE_CV_AUDITS_PER_DAY) {
      const reservation = await this.credits.reserve({
        userId,
        feature: FREE_AUDIT_FEATURE,
        credits: 0,
        referenceType: 'cv_audit_day',
        referenceId: window.dateKey,
      });
      const usedAfterClaim = await this.credits.countReservationsInWindow({
        userId,
        feature: FREE_AUDIT_FEATURE,
        from: window.from,
        to: window.to,
      });

      if (usedAfterClaim <= LIMITS.FREE_CV_AUDITS_PER_DAY) {
        const paidAuditCredits = await this.pricing.resolve(PAID_AUDIT_FEATURE);
        return {
          mode: 'FREE',
          reservationId: reservation.id,
          freeAuditsUsed: usedAfterClaim,
          unitCredits: 0,
          paidAuditCredits,
          window,
        };
      }

      await this.credits.release(reservation.id, 'Kuota audit gratis harian sudah terpakai');
    }

    const paidEstimate = await this.credits.assertAffordable(userId, PAID_AUDIT_FEATURE);
    const reservation = await this.credits.reserve({
      userId,
      feature: PAID_AUDIT_FEATURE,
      credits: paidEstimate.unitCredits,
      referenceType: 'cv_audit_day',
      referenceId: window.dateKey,
    });

    return {
      mode: 'PAID',
      reservationId: reservation.id,
      freeAuditsUsed: LIMITS.FREE_CV_AUDITS_PER_DAY,
      unitCredits: paidEstimate.unitCredits,
      paidAuditCredits: paidEstimate.unitCredits,
      window,
    };
  }

  private toJob(job: CvAuditJobWithRelations): CvAuditJob {
    const analysis = job.analysis;
    const result = analysis ? cvAuditResultSchema.parse(analysis.result) : null;

    return {
      auditId: job.id,
      status: job.status,
      analysisId: analysis?.id ?? null,
      result,
      billing: analysis
        ? {
            mode: job.mode,
            creditsCharged: job.creditsCharged,
            freeAuditsLimit: LIMITS.FREE_CV_AUDITS_PER_DAY,
            freeAuditsUsed: job.freeAuditsUsed,
            freeAuditsRemaining: Math.max(0, LIMITS.FREE_CV_AUDITS_PER_DAY - job.freeAuditsUsed),
            resetsAt: job.resetsAt.toISOString(),
            paidAuditCredits: job.paidAuditCredits,
          }
        : null,
      failure:
        job.status === 'FAILED'
          ? {
              code: job.failureCode ?? 'INTERNAL_ERROR',
              message: job.failureReason ?? 'Audit CV gagal diproses.',
            }
          : null,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * Validates and persists an upload, then enqueues background AI processing.
   * The HTTP request returns as soon as the queue accepts the durable job.
   */
  async submit(input: AuditCvInput): Promise<CvAuditJob> {
    const file = validatePdfUpload(input.file);
    const extracted = await extractPdfTextOrThrow(file.buffer);
    const grant = await this.claimQuota(input.userId);

    let auditJobId: string | null = null;
    try {
      const { auditJob, document } = await this.repository.createAuditJobWithDocument({
        userId: input.userId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        pageCount: extracted.pageCount,
        textContent: extracted.text,
        textHash: hashText(extracted.text),
        mode: grant.mode,
        reservationId: grant.reservationId,
        freeAuditsUsed: grant.freeAuditsUsed,
        paidAuditCredits: grant.paidAuditCredits,
        resetsAt: new Date(grant.window.resetsAt),
      });
      auditJobId = auditJob.id;

      await getCvProcessingQueue().enqueue({ kind: 'AUDIT', id: auditJob.id });

      return this.toJob({
        ...auditJob,
        document: {
          fileName: document.fileName,
          textContent: document.textContent,
          pageCount: document.pageCount,
        },
        analysis: null,
      });
    } catch (error) {
      await this.credits
        .release(grant.reservationId, 'Audit CV gagal dimasukkan ke antrean')
        .catch(() => undefined);
      if (auditJobId) {
        await this.repository.deleteAuditJob(auditJobId).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Runs one queue attempt. Re-delivery after a completed job is a no-op. */
  async processAudit(auditJobId: string, isFinalAttempt: boolean): Promise<void> {
    const job = await this.repository.findAuditJobWithRelations(auditJobId);
    if (!job || job.status === 'COMPLETED' || job.status === 'FAILED') return;

    await this.repository.updateAuditJob(auditJobId, {
      status: 'PROCESSING',
      startedAt: job.startedAt ?? new Date(),
      failureCode: null,
      failureReason: null,
    });

    try {
      const existing = await this.repository.findAnalysisForAuditJob(auditJobId);
      if (existing) {
        await this.repository.updateAuditJob(auditJobId, {
          status: 'COMPLETED',
          creditsCharged: existing.creditsCharged,
          completedAt: new Date(),
        });
        return;
      }

      const cvText = job.document?.textContent;
      if (!cvText) {
        throw AppError.textExtractionFailed({ auditJobId });
      }

      const provider = getAiProvider();
      const prompt = buildJobSeekerAuditPrompt({ cvText });
      const analysis = await provider.analyzeCv({ prompt });

      const completeResult = {
        ...analysis.data,
        extraction: {
          pageCount: job.document?.pageCount ?? 0,
          charCount: cvText.length,
          detectedLanguage: null,
          fileName: job.document?.fileName ?? null,
        },
        ephemeral: false,
        analyzedAt: new Date().toISOString(),
        provider: analysis.provider,
        model: analysis.model,
        promptVersion: analysis.promptVersion,
      };

      const settlement = await this.credits.settle({
        reservationId: job.reservationId,
        credits: job.mode === 'FREE' ? 0 : job.paidAuditCredits,
        description:
          job.mode === 'FREE'
            ? 'Audit CV gratis'
            : `Audit CV tambahan (${job.paidAuditCredits} kredit)`,
        idempotencyKey: `cv_audit:${job.reservationId}`,
      });
      await this.repository.updateAuditJob(auditJobId, {
        creditsCharged: settlement.charged,
      });

      let persisted = await this.repository.findAnalysisForAuditJob(auditJobId);
      if (!persisted) {
        try {
          persisted = await this.repository.createAnalysis({
            auditJobId,
            documentId: job.documentId,
            userId: job.userId,
            kind: job.mode === 'FREE' ? 'FREE_AUDIT' : 'DEEP_ANALYSIS',
            provider: analysis.provider,
            model: analysis.model,
            promptVersion: analysis.promptVersion,
            atsScore: analysis.data.atsScore,
            result: completeResult,
            creditsCharged: settlement.charged,
          });
          await recordAiUsage({
            userId: job.userId,
            feature: job.mode === 'FREE' ? FREE_AUDIT_FEATURE : PAID_AUDIT_FEATURE,
            result: analysis,
            creditsCharged: settlement.charged,
          });
        } catch (error) {
          persisted = await this.repository.findAnalysisForAuditJob(auditJobId);
          if (!persisted) throw error;
        }
      }

      await this.repository.updateAuditJob(auditJobId, {
        status: 'COMPLETED',
        creditsCharged: settlement.charged,
        completedAt: new Date(),
        failureCode: null,
        failureReason: null,
      });
    } catch (error) {
      const persisted = await this.repository.findAnalysisForAuditJob(auditJobId).catch(() => null);
      if (persisted) {
        await this.repository
          .updateAuditJob(auditJobId, {
            status: 'COMPLETED',
            creditsCharged: persisted.creditsCharged,
            completedAt: new Date(),
            failureCode: null,
            failureReason: null,
          })
          .catch(() => undefined);
        return;
      }

      const failure = failureFor(error);
      if (!isFinalAttempt) {
        await this.repository
          .updateAuditJob(auditJobId, {
            status: 'QUEUED',
            startedAt: null,
            failureCode: failure.code,
            failureReason: failure.message,
          })
          .catch(() => undefined);
        throw error;
      }

      const current = await this.repository.findAuditJobWithRelations(auditJobId);
      if (current && current.creditsCharged > 0) {
        await this.credits
          .refund({
            userId: current.userId,
            credits: current.creditsCharged,
            description: 'Refund Audit CV (pemrosesan gagal)',
            referenceType: 'cv_audit',
            referenceId: current.reservationId,
            idempotencyKey: `cv_audit_refund:${current.reservationId}`,
          })
          .catch(() => undefined);
      } else {
        await this.credits.release(job.reservationId, 'Audit CV gagal').catch(() => undefined);
      }

      await this.repository
        .updateAuditJob(auditJobId, {
          status: 'FAILED',
          failureCode: failure.code,
          failureReason: failure.message,
          completedAt: new Date(),
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /** Owner-scoped status used by the polling UI and after a browser refresh. */
  async getJob(auditJobId: string, userId: string): Promise<CvAuditJob> {
    const job = await this.repository.findAuditJobWithRelations(auditJobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Audit CV tidak ditemukan.');
    }
    return this.toJob(job);
  }

  /** The audit for a stored document, used by the paid deep-analysis flow. */
  async requireOwnedDocument(documentId: string, userId: string): Promise<string> {
    const document = await this.repository.findDocument(documentId);
    if (!document || document.userId !== userId) {
      throw AppError.notFound('Dokumen CV tidak ditemukan.');
    }
    if (!document.textContent) {
      throw AppError.textExtractionFailed({ documentId, reason: 'no stored text' });
    }
    return document.textContent;
  }
}

export const cvAuditService = new CvAuditService();
