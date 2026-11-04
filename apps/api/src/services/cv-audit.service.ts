import { createHash } from 'node:crypto';

import { LIMITS, type CvAuditResponse, type CvAuditUsage, type FeatureKey } from '@aseb/shared';

import { CvRepository } from '../repositories/cv.repository.js';
import { getAiProvider } from '../providers/ai/index.js';
import { buildJobSeekerAuditPrompt } from '../prompts/jobSeeker/auditPrompt.js';
import { AppError } from '../utils/errors.js';
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

/**
 * The free CV audit.
 *
 * Authentication is mandatory. Each account gets five free audits per Jakarta calendar
 * day; later audits use the admin-editable `CV_DEEP_ANALYSIS` price. The first five are
 * tracked as zero-credit reservations so the quota has a durable, account-scoped audit
 * trail without inventing a second wallet or usage table.
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
      // Claim a free slot before the expensive work starts. Counting after insertion means
      // concurrent requests can never push the number of free slots above the daily limit.
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

  async audit(input: AuditCvInput): Promise<CvAuditResponse> {
    const file = validatePdfUpload(input.file);
    const userId = input.userId;
    const grant = await this.claimQuota(userId);
    let settled = false;

    try {
      const extracted = await extractPdfTextOrThrow(file.buffer);

      const provider = getAiProvider();
      // Prompts are composed by the prompt layer, never by the provider or the service.
      const prompt = buildJobSeekerAuditPrompt({ cvText: extracted.text });
      const analysis = await provider.analyzeCv({ prompt });

      const result = {
        ...analysis.data,
        extraction: {
          pageCount: extracted.pageCount,
          charCount: extracted.charCount,
          detectedLanguage: null,
          fileName: file.fileName,
        },
        ephemeral: false,
        analyzedAt: new Date().toISOString(),
        provider: analysis.provider,
        model: analysis.model,
        promptVersion: analysis.promptVersion,
      };

      const settlement = await this.credits.settle({
        reservationId: grant.reservationId,
        credits: grant.unitCredits,
        description:
          grant.mode === 'FREE'
            ? 'Audit CV gratis'
            : `Audit CV tambahan (${grant.unitCredits} kredit)`,
        idempotencyKey: `cv_audit:${grant.reservationId}`,
      });
      settled = true;

      let documentId: string | null = null;
      let auditId: string;
      try {
        const document = await this.repository.createDocument({
          userId,
          kind: 'ORIGINAL',
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          pageCount: extracted.pageCount,
          textContent: extracted.text,
          textHash: hashText(extracted.text),
        });
        documentId = document.id;

        const persisted = await this.repository.createAnalysis({
          documentId: document.id,
          userId,
          kind: grant.mode === 'FREE' ? 'FREE_AUDIT' : 'DEEP_ANALYSIS',
          provider: analysis.provider,
          model: analysis.model,
          promptVersion: analysis.promptVersion,
          atsScore: analysis.data.atsScore,
          result,
          creditsCharged: settlement.charged,
        });
        auditId = persisted.id;
      } catch (error) {
        if (documentId) {
          await this.repository.deleteDocument(documentId, userId).catch(() => undefined);
        }
        if (settlement.charged > 0) {
          await this.credits
            .refund({
              userId,
              credits: settlement.charged,
              description: 'Refund Audit CV (hasil gagal disimpan)',
              referenceType: 'cv_audit',
              referenceId: grant.reservationId,
              idempotencyKey: `cv_audit_refund:${grant.reservationId}`,
            })
            .catch(() => undefined);
        }
        throw error;
      }

      await recordAiUsage({
        userId,
        feature: grant.mode === 'FREE' ? FREE_AUDIT_FEATURE : PAID_AUDIT_FEATURE,
        result: analysis,
        creditsCharged: settlement.charged,
      });

      return {
        auditId,
        result,
        billing: {
          mode: grant.mode,
          creditsCharged: settlement.charged,
          freeAuditsLimit: LIMITS.FREE_CV_AUDITS_PER_DAY,
          freeAuditsUsed: grant.freeAuditsUsed,
          freeAuditsRemaining: LIMITS.FREE_CV_AUDITS_PER_DAY - grant.freeAuditsUsed,
          resetsAt: grant.window.resetsAt,
          paidAuditCredits: grant.paidAuditCredits,
        },
      };
    } catch (error) {
      if (!settled) {
        await this.credits.release(grant.reservationId, 'Audit CV gagal').catch(() => undefined);
      }
      throw error;
    }
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
