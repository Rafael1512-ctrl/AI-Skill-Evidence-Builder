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
import { getAiProvider } from '../providers/ai/index.js';
import { buildJobSeekerEnhancementPrompt } from '../prompts/jobSeeker/enhancePrompt.js';
import { CvRepository } from '../repositories/cv.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/errors.js';
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

/**
 * The paid CV enhancement flow.
 *
 * Order of operations: validate -> preflight -> RESERVE -> extract & call the model ->
 * SETTLE (or RELEASE) -> persist. Credits are held before the expensive work and only
 * charged when a validated document is actually produced; a failure releases the hold
 * and leaves the enhancement `FAILED`, never silently charged.
 */
export class CvEnhancementService {
  constructor(
    private readonly repository = new CvRepository(),
    private readonly users = new UserRepository(),
    private readonly credits: CreditService = creditService,
    private readonly pricing: PricingService = pricingService,
  ) {}

  private toDetail(enhancement: CvEnhancement, originalText: string): CvEnhancementDetail {
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
      originalText,
      promptVersion: enhancement.promptVersion ?? ENHANCE_PROMPT_VERSION,
    };
  }

  async enhance(input: EnhanceCvInput): Promise<{ enhancement: CvEnhancementDetail }> {
    const file = validatePdfUpload(input.file);
    const options = input.options;

    // Preflight first, so an unaffordable request creates no rows at all.
    await this.credits.assertAffordable(input.userId, ENHANCE_FEATURE);

    const reservation = await this.credits.reserve({
      userId: input.userId,
      feature: ENHANCE_FEATURE,
      referenceType: 'cv_enhancement',
    });

    let enhancementId: string | null = null;
    let settled = false;

    try {
      const extracted = await extractPdfTextOrThrow(file.buffer);

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

      // Saved profile data is read only when the user consented to it in this request.
      const profile = options.useProfileContext
        ? await this.users.findById(input.userId)
        : null;

      const prompt = buildJobSeekerEnhancementPrompt({
        cvText: extracted.text,
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

      const enhancement = await this.repository.createEnhancement({
        userId: input.userId,
        sourceDocumentId: sourceDocument.id,
        options: options as unknown as Prisma.InputJsonValue,
        templateKey: options.templateKey,
        reservationId: reservation.id,
        promptVersion: prompt.version,
      });
      enhancementId = enhancement.id;

      const result = await getAiProvider().enhanceCv({ prompt });

      const settlement = await this.credits.settle({
        reservationId: reservation.id,
        credits: await this.pricing.resolve(ENHANCE_FEATURE),
        description: 'Peningkatan CV',
        idempotencyKey: `cv_enhancement:${enhancement.id}`,
      });
      settled = true;

      let updated: CvEnhancement;
      try {
        updated = await this.repository.updateEnhancement(enhancement.id, {
          status: 'COMPLETED',
          document: result.data as unknown as Prisma.InputJsonValue,
          creditsCharged: settlement.charged,
          completedAt: new Date(),
        });
      } catch (error) {
        // The model produced a document but it could not be stored: return the credits
        // instead of charging for a result the user can never open.
        await this.credits
          .refund({
            userId: input.userId,
            credits: settlement.charged,
            description: 'Refund Peningkatan CV (hasil gagal disimpan)',
            referenceType: 'cv_enhancement',
            referenceId: enhancement.id,
          })
          .catch(() => undefined);
        await this.repository
          .updateEnhancement(enhancement.id, {
            status: 'FAILED',
            failureReason: 'Hasil peningkatan gagal disimpan.',
            completedAt: new Date(),
          })
          .catch(() => undefined);
        throw error;
      }

      await recordAiUsage({
        userId: input.userId,
        feature: ENHANCE_FEATURE,
        result,
        creditsCharged: settlement.charged,
        cvEnhancementId: enhancement.id,
      });

      return { enhancement: this.toDetail(updated, extracted.text) };
    } catch (error) {
      if (!settled) {
        await this.credits
          .release(reservation.id, 'Peningkatan CV gagal')
          .catch(() => undefined);
        if (enhancementId) {
          await this.repository
            .updateEnhancement(enhancementId, {
              status: 'FAILED',
              failureReason:
                error instanceof AppError ? error.message : 'Peningkatan CV gagal.',
              completedAt: new Date(),
            })
            .catch(() => undefined);
        }
      }
      throw error;
    }
  }

  /** Owner-scoped detail, including the original text needed for Before vs After. */
  async getEnhancement(enhancementId: string, userId: string): Promise<CvEnhancementDetail> {
    const enhancement = await this.repository.findEnhancement(enhancementId);
    if (!enhancement || enhancement.userId !== userId) {
      throw AppError.notFound('Hasil peningkatan CV tidak ditemukan.');
    }

    const originalText = enhancement.sourceDocumentId
      ? ((await this.repository.findDocument(enhancement.sourceDocumentId))?.textContent ?? '')
      : '';

    return this.toDetail(enhancement, originalText);
  }
}

export const cvEnhancementService = new CvEnhancementService();
