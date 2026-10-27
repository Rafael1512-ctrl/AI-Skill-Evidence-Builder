import { createHash } from 'node:crypto';

import {
  CV_TEMPLATE_KEYS,
  cvEnhancementDocumentSchema,
  type CvExportResult,
  type CvTemplateKey,
  type FeatureKey,
} from '@aseb/shared';
import { z } from 'zod';

import type { CvEnhancement } from '../generated/prisma/client.js';
import { getPdfRenderer } from '../providers/pdf/index.js';
import { CvRepository } from '../repositories/cv.repository.js';
import { cvDocumentToPlainText, cvExportFileName, renderCvHtml } from '../templates/cv/index.js';
import { AppError } from '../utils/errors.js';
import { creditService, type CreditService } from './credit.service.js';
import { pricingService, type PricingService } from './pricing.service.js';

/**
 * Exporting owns the `CV_PDF_EXPORT` feature key. The price (1 credit by default) always
 * resolves through the pricing service, never a literal in this file.
 */
const EXPORT_FEATURE: FeatureKey = 'CV_PDF_EXPORT';

export interface ExportCvInput {
  userId: string;
  enhancementId: string;
  templateKey?: CvTemplateKey | undefined;
}

function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Renders a completed enhancement to PDF.
 *
 * Order of operations: ownership + state check -> preflight -> RESERVE -> render (the
 * expensive step; Chromium) -> SETTLE -> persist. A failure releases the hold, so a
 * renderer that never produced a file never costs the user a credit.
 */
export class CvExportService {
  constructor(
    private readonly repository = new CvRepository(),
    private readonly credits: CreditService = creditService,
    private readonly pricing: PricingService = pricingService,
  ) {}

  async export(input: ExportCvInput): Promise<CvExportResult> {
    const enhancement = await this.requireCompletedEnhancement(input.enhancementId, input.userId);
    const document = cvEnhancementDocumentSchema.parse(enhancement.document);
    const templateKey =
      input.templateKey ?? z.enum(CV_TEMPLATE_KEYS).parse(enhancement.templateKey);

    await this.credits.assertAffordable(input.userId, EXPORT_FEATURE);

    const reservation = await this.credits.reserve({
      userId: input.userId,
      feature: EXPORT_FEATURE,
      referenceType: 'cv_export',
      referenceId: enhancement.id,
    });

    let settled = false;

    try {
      const html = renderCvHtml({ document, templateKey });
      const fileName = cvExportFileName({ document, templateKey });
      const rendered = await getPdfRenderer().render({
        html,
        title: `${document.fullName} - CV`,
      });

      const settlement = await this.credits.settle({
        reservationId: reservation.id,
        credits: await this.pricing.resolve(EXPORT_FEATURE),
        description: `Ekspor PDF CV (${templateKey})`,
        idempotencyKey: `cv_export:${enhancement.id}:${reservation.id}`,
      });
      settled = true;

      try {
        const generated = await this.repository.createDocument({
          userId: input.userId,
          kind: 'ENHANCED',
          fileName,
          mimeType: 'application/pdf',
          sizeBytes: rendered.buffer.byteLength,
          pageCount: rendered.pageCount,
          textContent: cvDocumentToPlainText(document),
          textHash: hashBytes(rendered.buffer),
        });

        await this.repository.updateEnhancement(enhancement.id, {
          resultDocumentId: generated.id,
          templateKey,
        });

        return {
          documentId: generated.id,
          enhancementId: enhancement.id,
          templateKey,
          fileName,
          mimeType: 'application/pdf',
          sizeBytes: rendered.buffer.byteLength,
          pageCount: rendered.pageCount,
          creditsCharged: settlement.charged,
          contentBase64: rendered.buffer.toString('base64'),
          createdAt: generated.createdAt.toISOString(),
        };
      } catch (error) {
        // The PDF was produced but its record could not be written: return the credits
        // rather than charge for an export the user cannot find again.
        await this.credits
          .refund({
            userId: input.userId,
            credits: settlement.charged,
            description: 'Refund Ekspor PDF (hasil gagal disimpan)',
            referenceType: 'cv_export',
            referenceId: enhancement.id,
          })
          .catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!settled) {
        await this.credits
          .release(reservation.id, 'Ekspor PDF gagal')
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private async requireCompletedEnhancement(
    enhancementId: string,
    userId: string,
  ): Promise<CvEnhancement> {
    const enhancement = await this.repository.findEnhancement(enhancementId);
    if (!enhancement || enhancement.userId !== userId) {
      throw AppError.notFound('Hasil peningkatan CV tidak ditemukan.');
    }
    if (enhancement.status !== 'COMPLETED' || !enhancement.document) {
      throw AppError.conflict('Peningkatan CV belum selesai sehingga belum bisa diekspor.');
    }
    return enhancement;
  }
}

export const cvExportService = new CvExportService();
