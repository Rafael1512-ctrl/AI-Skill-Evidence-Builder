import {
  CV_TEMPLATE_KEYS,
  cvEnhancementDocumentSchema,
  cvEnhancementOptionsSchema,
  type CvEnhancementDetail,
  type CvEnhancementOptions,
  type CvTemplateKey,
  type FeatureKey,
} from '@aseb/shared';
import { z } from 'zod';

import type { CvEnhancement, Prisma } from '../generated/prisma/client.js';
import { getCvProcessingQueue } from '../queues/cv-processing.queue.js';
import { getAiProvider } from '../providers/ai/index.js';
import { buildJobSeekerEnhancementPrompt } from '../prompts/jobSeeker/enhancePrompt.js';
import { CvRepository } from '../repositories/cv.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError, isAppError } from '../utils/errors.js';
import { validatePdfUpload } from '../utils/file-validation.js';
import { recordAiUsage } from './ai-usage.service.js';
import { creditService, type CreditService } from './credit.service.js';
import { hashText } from './cv-audit.service.js';
import { extractPdfTextOrThrow } from './pdf-extraction.service.js';
import { pricingService, type PricingService } from './pricing.service.js';

/**
 * The paid CV enhancement owns the `CV_ENHANCEMENT` feature key. The concrete price
 * (5 credits by default) always comes from the pricing service, never from this file.
 */
const ENHANCE_FEATURE: FeatureKey = 'CV_ENHANCEMENT';

/** Used only as a fallback when reading a row created before versioning existed. */
const ENHANCE_PROMPT_VERSION = 'JOB_SEEKER_ENHANCE_V1';

export interface EnhanceCvInput {
  userId: string;
  file: {
    originalname?: string | undefined;
    mimetype?: string | undefined;
    size: number;
    buffer: Buffer;
  };
  options: CvEnhancementOptions;
}

function safeFailureReason(error: unknown): string {
  return isAppError(error) ? error.message : 'Peningkatan CV gagal diproses. Silakan coba lagi.';
}

/**
 * The paid CV enhancement is asynchronous:
 *
 * - `submit` validates the PDF, extracts text, reserves credits and persists a PENDING
 *   enhancement together with its source document.
 * - `processEnhancement` builds the prompt, calls the provider, settles credits and stores
 *   the result in the background worker.
 *
 * The record itself is the durable job, so refreshing or reopening the page resumes status
 * polling without creating another charge.
 */
export class CvEnhancementService {
  constructor(
    private readonly repository = new CvRepository(),
    private readonly users = new UserRepository(),
    private readonly credits: CreditService = creditService,
    private readonly pricing: PricingService = pricingService,
  ) {}

  private toDetail(
    enhancement: CvEnhancement,
    source: { fileName: string | null; originalText: string },
  ): CvEnhancementDetail {
    return {
      id: enhancement.id,
      sourceDocumentId: enhancement.sourceDocumentId,
      status: enhancement.status,
      options: cvEnhancementOptionsSchema.parse(enhancement.options),
      document: enhancement.document
        ? cvEnhancementDocumentSchema.parse(enhancement.document)
        : null,
      templateKey: z.enum(CV_TEMPLATE_KEYS).parse(enhancement.templateKey) as CvTemplateKey,
      creditsCharged: enhancement.creditsCharged,
      createdAt: enhancement.createdAt.toISOString(),
      completedAt: enhancement.completedAt?.toISOString() ?? null,
      fileName: source.fileName,
      originalText: source.originalText,
      promptVersion: enhancement.promptVersion ?? ENHANCE_PROMPT_VERSION,
      failureReason: enhancement.failureReason,
    };
  }

  /** Persist the upload and credit hold, then return without waiting for the model call. */
  async enhance(input: EnhanceCvInput): Promise<{ enhancement: CvEnhancementDetail }> {
    const file = validatePdfUpload(input.file);
    const extracted = await extractPdfTextOrThrow(file.buffer);
    const options = input.options;

    // Preflight first, so an unaffordable request creates no rows at all.
    await this.credits.assertAffordable(input.userId, ENHANCE_FEATURE);
    const reservation = await this.credits.reserve({
      userId: input.userId,
      feature: ENHANCE_FEATURE,
      referenceType: 'cv_enhancement',
    });

    let enhancementId: string | null = null;
    let sourceDocumentId: string | null = null;
    try {
      const sourceDocument = await this.repository.createDocument({
        userId: input.userId,
        kind: 'ORIGINAL',
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        pageCount: extracted.pageCount,
        textContent: extracted.text,
        textHash: hashText(extracted.text),
      });
      sourceDocumentId = sourceDocument.id;

      const enhancement = await this.repository.createEnhancement({
        userId: input.userId,
        sourceDocumentId: sourceDocument.id,
        options: options as unknown as Prisma.InputJsonValue,
        templateKey: options.templateKey,
        reservationId: reservation.id,
        promptVersion: ENHANCE_PROMPT_VERSION,
      });
      enhancementId = enhancement.id;

      await getCvProcessingQueue().enqueue({ kind: 'ENHANCEMENT', id: enhancement.id });

      return {
        enhancement: this.toDetail(enhancement, {
          fileName: sourceDocument.fileName,
          originalText: extracted.text,
        }),
      };
    } catch (error) {
      await this.credits
        .release(reservation.id, 'Peningkatan CV gagal dimasukkan ke antrean')
        .catch(() => undefined);
      if (enhancementId) {
        await this.repository.deleteEnhancement(enhancementId).catch(() => undefined);
      }
      if (sourceDocumentId) {
        await this.repository.deleteDocument(sourceDocumentId, input.userId).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Runs one queue attempt. Re-delivery after a terminal state is a no-op. */
  async processEnhancement(enhancementId: string, isFinalAttempt: boolean): Promise<void> {
    const enhancement = await this.repository.findEnhancementWithSource(enhancementId);
    if (
      !enhancement ||
      enhancement.status === 'COMPLETED' ||
      enhancement.status === 'FAILED' ||
      enhancement.status === 'REFUNDED'
    ) {
      return;
    }
    if (!enhancement.reservationId) {
      throw new Error(`Enhancement ${enhancementId} has no credit reservation.`);
    }

    await this.repository.updateEnhancement(enhancementId, {
      status: 'PROCESSING',
      failureReason: null,
    });
    const originalText = enhancement.sourceDocument?.textContent;

    try {
      if (!originalText) {
        throw AppError.textExtractionFailed({ enhancementId });
      }

      const options = cvEnhancementOptionsSchema.parse(enhancement.options);
      const profile = options.useProfileContext
        ? await this.users.findById(enhancement.userId)
        : null;
      const prompt = buildJobSeekerEnhancementPrompt({
        cvText: originalText,
        templateKey: options.templateKey,
        useProfileContext: options.useProfileContext,
        targetCareer: options.targetCareer,
        targetPosition: options.targetPosition,
        profile: profile
          ? {
              fullName: profile.fullName,
              headline: profile.headline,
              location: profile.location,
              githubUrl: profile.githubUrl,
              linkedinUrl: profile.linkedinUrl,
              portfolioUrl: profile.portfolioUrl,
            }
          : undefined,
        links: {
          githubUrl: options.githubUrl,
          linkedinUrl: options.linkedinUrl,
          portfolioUrl: options.portfolioUrl,
        },
        additionalNotes: options.additionalNotes,
      });

      const result = await getAiProvider().enhanceCv({ prompt });
      const settlement = await this.credits.settle({
        reservationId: enhancement.reservationId,
        credits: await this.pricing.resolve(ENHANCE_FEATURE),
        description: 'Peningkatan CV',
        idempotencyKey: `cv_enhancement:${enhancement.id}`,
      });

      // Persist the charge immediately so a later persistence failure can refund it.
      await this.repository.updateEnhancement(enhancement.id, {
        creditsCharged: settlement.charged,
      });

      const updated = await this.repository.updateEnhancement(enhancement.id, {
        status: 'COMPLETED',
        document: result.data as unknown as Prisma.InputJsonValue,
        templateKey: options.templateKey,
        creditsCharged: settlement.charged,
        failureReason: null,
        completedAt: new Date(),
      });

      await recordAiUsage({
        userId: enhancement.userId,
        feature: ENHANCE_FEATURE,
        result,
        creditsCharged: settlement.charged,
        cvEnhancementId: updated.id,
      });
    } catch (error) {
      if (!isFinalAttempt) {
        await this.repository
          .updateEnhancement(enhancementId, {
            status: 'PENDING',
            failureReason: null,
          })
          .catch(() => undefined);
        throw error;
      }

      const current = await this.repository.findEnhancement(enhancementId);
      if (current && current.creditsCharged > 0) {
        await this.credits
          .refund({
            userId: current.userId,
            credits: current.creditsCharged,
            description: 'Refund Peningkatan CV (pemrosesan gagal)',
            referenceType: 'cv_enhancement',
            referenceId: current.id,
            idempotencyKey: `cv_enhancement_refund:${current.id}`,
          })
          .catch(() => undefined);
      } else {
        await this.credits
          .release(enhancement.reservationId, 'Peningkatan CV gagal')
          .catch(() => undefined);
      }

      await this.repository
        .updateEnhancement(enhancementId, {
          status: 'FAILED',
          creditsCharged: 0,
          failureReason: safeFailureReason(error),
          completedAt: new Date(),
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /** Owner-scoped detail, including status used by the polling UI. */
  async getEnhancement(enhancementId: string, userId: string): Promise<CvEnhancementDetail> {
    const enhancement = await this.repository.findEnhancementWithSource(enhancementId);
    if (!enhancement || enhancement.userId !== userId) {
      throw AppError.notFound('Hasil peningkatan CV tidak ditemukan.');
    }

    return this.toDetail(enhancement, {
      fileName: enhancement.sourceDocument?.fileName ?? null,
      // Deleting a CV clears its text, so a deleted source reads as empty here.
      originalText: enhancement.sourceDocument?.textContent ?? '',
    });
  }
}

export const cvEnhancementService = new CvEnhancementService();
