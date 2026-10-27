import { createHash } from 'node:crypto';

import { FEATURE_KEYS, type CvAuditResponse } from '@aseb/shared';

import { CvRepository } from '../repositories/cv.repository.js';
import { getAiProvider } from '../providers/ai/index.js';
import { buildJobSeekerAuditPrompt } from '../prompts/jobSeeker/auditPrompt.js';
import { AppError } from '../utils/errors.js';
import { validatePdfUpload } from '../utils/file-validation.js';
import { recordAiUsage } from './ai-usage.service.js';
import { extractPdfTextOrThrow } from './pdf-extraction.service.js';

export interface AuditCvInput {
  file: {
    originalname?: string | undefined;
    mimetype?: string | undefined;
    size: number;
    buffer: Buffer;
  };
  /** Present for authenticated users; absent for guests (nothing is persisted). */
  userId?: string | null;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The free CV audit.
 *
 * Guests get the same analysis as signed-in users at 0 credits, but nothing is
 * persisted: the upload is processed in memory and discarded (data minimisation).
 */
export class CvAuditService {
  constructor(private readonly repository = new CvRepository()) {}

  async audit(input: AuditCvInput): Promise<CvAuditResponse> {
    const file = validatePdfUpload(input.file);
    const extracted = await extractPdfTextOrThrow(file.buffer);

    const provider = getAiProvider();
    // Prompts are composed by the prompt layer, never by the provider or the service.
    const prompt = buildJobSeekerAuditPrompt({ cvText: extracted.text });
    const analysis = await provider.analyzeCv({ prompt });
    const userId = input.userId ?? null;

    const result = {
      ...analysis.data,
      extraction: {
        pageCount: extracted.pageCount,
        charCount: extracted.charCount,
        detectedLanguage: null,
        fileName: file.fileName,
      },
      ephemeral: userId === null,
      analyzedAt: new Date().toISOString(),
      provider: analysis.provider,
      model: analysis.model,
      promptVersion: analysis.promptVersion,
    };

    let auditId: string | null = null;

    if (userId) {
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

      const persisted = await this.repository.createAnalysis({
        documentId: document.id,
        userId,
        kind: 'FREE_AUDIT',
        provider: analysis.provider,
        model: analysis.model,
        promptVersion: analysis.promptVersion,
        atsScore: analysis.data.atsScore,
        result,
        creditsCharged: 0,
      });

      auditId = persisted.id;
    }

    await recordAiUsage({
      userId,
      feature: FEATURE_KEYS[0],
      result: analysis,
      creditsCharged: 0,
    });

    return { auditId, result };
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
