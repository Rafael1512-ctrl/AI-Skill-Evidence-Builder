import {
  LIMITS,
  type ScreeningBatchRejection,
  type ScreeningBatchUploadResult,
  type ScreeningCandidateList,
  type ScreeningCandidateSummary,
} from '@aseb/shared';

import { env } from '../config/env.js';
import type { ScreeningCandidate } from '../generated/prisma/client.js';
import { getScreeningQueue } from '../queues/index.js';
import { ScreeningRepository } from '../repositories/screening.repository.js';
import { AppError, isAppError } from '../utils/errors.js';
import { hasZipSignature, validatePdfUpload } from '../utils/file-validation.js';
import { sha256Hex } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import {
  extractPdfEntriesFromZip,
  type ZipExtractionResult,
  type ZipLimits,
} from '../utils/zip.js';
import { creditService, type CreditService } from './credit.service.js';
import { extractPdfText } from './pdf-extraction.service.js';
import { screeningService, type ScreeningService } from './screening.service.js';

/** The per-CV feature key; the credit amount always comes from the pricing service. */
const SCREENING_FEATURE = 'HRD_SCREEN_PER_CV';

/** Multer accepts at most this many files, and the product copy promises the same number. */
const MAX_CANDIDATES = LIMITS.MAX_SCREENING_CVS;

export interface UploadedCandidateFile {
  originalname?: string | undefined;
  mimetype?: string | undefined;
  size: number;
  buffer: Buffer;
}

interface ProcessedCandidate {
  candidateName: string;
  fileName: string;
  fileSizeBytes: number;
  cvText: string;
  textHash: string;
  pageCount: number;
}

type FileOutcome =
  { ok: true; candidate: ProcessedCandidate } | { ok: false; rejection: ScreeningBatchRejection };

/**
 * Turns a display name into a candidate label while the real name is still unknown.
 *
 * Phase 11 has no evidence extraction yet, so the label comes from the file name only.
 * Nothing is inferred about the person; Phase 13 may replace it with a name found in the
 * CV text, and the recruiter can always edit it later.
 */
export function candidateNameFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_+]+/g, ' ')
    .replace(/[-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.length > 0 ? base.slice(0, 200) : 'Kandidat';
}

function toCandidateSummary(candidate: ScreeningCandidate): ScreeningCandidateSummary {
  return {
    id: candidate.id,
    candidateName: candidate.candidateName,
    fileName: candidate.fileName,
    fileSizeBytes: candidate.fileSizeBytes,
    state: candidate.state,
    attempts: candidate.attempts,
    pageCount: candidate.pageCount,
    score: candidate.score,
    eligibilityStatus: candidate.eligibilityStatus,
    verificationStatus: candidate.verificationStatus,
    failureReason: candidate.failureReason,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

/**
 * Batch upload for a screening job (Phase 11 slice).
 *
 * Accepts up to `LIMITS.MAX_SCREENING_CVS` PDFs, or one ZIP of the same size, extracts
 * their text immediately (no OCR - a scanned PDF is reported as rejected) and stores the
 * candidates as `QUEUED`. Credits for the accepted CVs are reserved before the batch is
 * persisted; nothing is queued, and nothing is charged, for a file that failed.
 *
 * Queueing (Phase 12) and evidence extraction (Phase 13) are intentionally out of scope:
 * the reservation stays `ACTIVE` until a worker settles or releases it per candidate.
 */
export class ScreeningBatchService {
  constructor(
    private readonly repository = new ScreeningRepository(),
    private readonly credits: CreditService = creditService,
    private readonly jobs: ScreeningService = screeningService,
  ) {}

  private get zipLimits(): ZipLimits {
    return {
      maxEntries: env.MAX_ZIP_ENTRIES,
      maxUncompressedBytes: env.MAX_ZIP_UNCOMPRESSED_BYTES,
      maxCompressionRatio: env.MAX_ZIP_COMPRESSION_RATIO,
      maxEntryBytes: LIMITS.MAX_PDF_BYTES,
      maxPdfFiles: MAX_CANDIDATES,
    };
  }

  /**
   * Splits the upload into candidate files.
   *
   * A single ZIP and a list of PDFs are mutually exclusive, and anything that is neither a
   * PDF nor a ZIP is rejected per file rather than aborting the request.
   */
  private async expandUploads(
    uploads: readonly UploadedCandidateFile[],
  ): Promise<ZipExtractionResult> {
    if (uploads.length === 0) {
      throw AppError.validation({ field: 'files' }, 'Tidak ada berkas CV yang diunggah.');
    }

    const zipUploads = uploads.filter((upload) => hasZipSignature(upload.buffer));
    const pdfUploads = uploads.filter((upload) => !hasZipSignature(upload.buffer));

    if (zipUploads.length > 0 && (zipUploads.length > 1 || pdfUploads.length > 0)) {
      throw AppError.validation(
        { zipCount: zipUploads.length, pdfCount: pdfUploads.length },
        'Kirim salah satu saja: hingga 50 berkas PDF, atau satu arsip ZIP.',
      );
    }

    if (zipUploads.length === 1) {
      const zip = zipUploads[0];
      if (!zip) throw AppError.validation({ field: 'files' }, 'Berkas ZIP tidak dapat dibaca.');
      return extractPdfEntriesFromZip(zip.buffer, this.zipLimits);
    }

    if (uploads.length > MAX_CANDIDATES) {
      throw AppError.validation(
        { maxFiles: MAX_CANDIDATES },
        `Batch maksimal berisi ${MAX_CANDIDATES} CV.`,
      );
    }

    return {
      files: uploads.map((upload) => ({
        fileName: upload.originalname ?? 'cv.pdf',
        entryPath: upload.originalname ?? 'cv.pdf',
        sizeBytes: upload.size,
        buffer: upload.buffer,
      })),
      rejected: [],
    };
  }

  /** Validates one file and extracts its text; failures become per-file rejections. */
  private async processFile(file: {
    fileName: string;
    sizeBytes: number;
    buffer: Buffer;
  }): Promise<FileOutcome> {
    try {
      const validated = validatePdfUpload({
        originalname: file.fileName,
        mimetype: 'application/pdf',
        size: file.sizeBytes,
        buffer: file.buffer,
      });

      const extracted = await extractPdfText(validated.buffer);
      if (!extracted.isTextBased) {
        return {
          ok: false,
          rejection: {
            fileName: validated.fileName,
            code: 'TEXT_EXTRACTION_FAILED',
            message: 'PDF hasil pindai (scan) belum didukung. Mohon unggah PDF berbasis teks.',
          },
        };
      }

      return {
        ok: true,
        candidate: {
          candidateName: candidateNameFromFileName(validated.fileName),
          fileName: validated.fileName,
          fileSizeBytes: validated.sizeBytes,
          cvText: extracted.text,
          textHash: sha256Hex(extracted.text),
          pageCount: extracted.pageCount,
        },
      };
    } catch (error) {
      if (!isAppError(error)) throw error;
      return {
        ok: false,
        rejection: { fileName: file.fileName, code: error.code, message: error.message },
      };
    }
  }

  async uploadCandidates(
    userId: string,
    jobId: string,
    uploads: readonly UploadedCandidateFile[],
  ): Promise<ScreeningBatchUploadResult> {
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }
    if (job.totalCandidates > 0) {
      throw AppError.conflict('Batch kandidat untuk sesi screening ini sudah diunggah.');
    }
    if (job.state !== 'CREATED') {
      throw AppError.conflict('Sesi screening ini tidak lagi menerima kandidat baru.');
    }

    const expanded = await this.expandUploads(uploads);
    const rejected: ScreeningBatchRejection[] = [...expanded.rejected];

    if (expanded.files.length === 0) {
      throw AppError.validation(
        { rejected },
        'Tidak ada berkas CV yang dapat diproses. Periksa daftar berkas yang ditolak.',
      );
    }
    if (expanded.files.length > MAX_CANDIDATES) {
      throw AppError.validation(
        { maxFiles: MAX_CANDIDATES },
        `Batch maksimal berisi ${MAX_CANDIDATES} CV.`,
      );
    }

    const accepted: ProcessedCandidate[] = [];
    for (const file of expanded.files) {
      const outcome = await this.processFile(file);
      if (outcome.ok) accepted.push(outcome.candidate);
      else rejected.push(outcome.rejection);
    }

    if (accepted.length === 0) {
      throw AppError.validation(
        { rejected },
        'Tidak ada CV yang berhasil diproses. Periksa daftar berkas yang ditolak.',
      );
    }

    // Reserve before persisting: an unaffordable batch must leave no rows behind.
    const reservation = await this.credits.reserve({
      userId,
      feature: SCREENING_FEATURE,
      quantity: accepted.length,
      referenceType: 'screening_job',
      referenceId: jobId,
    });

    let created: ScreeningCandidate[];
    try {
      created = await this.repository.createCandidatesForJob({
        jobId,
        candidates: accepted,
        reservationId: reservation.id,
        creditsReserved: reservation.reservedCredits,
      });
    } catch (error) {
      // The hold must not survive a batch that was never recorded.
      await this.credits
        .release(reservation.id, 'screening-batch-persist-failed')
        .catch(() => undefined);
      throw error;
    }

    // Queueing is best-effort relative to the batch: the rows and the credit hold are
    // already committed, so a broker problem must be recorded, not rolled back.
    try {
      await getScreeningQueue().enqueueCandidates({
        jobId,
        candidateIds: created.map((candidate) => candidate.id),
      });
    } catch (error) {
      logger.error({ err: error, jobId }, 'Could not enqueue the screening batch');
      await this.repository.recordJobEvent({
        jobId,
        type: 'ERROR',
        message: 'Kandidat tersimpan tetapi gagal dimasukkan ke antrean pemrosesan.',
        payload: { candidateCount: created.length },
      });
    }

    const summary = await this.jobs.jobSummary(userId, jobId);

    return {
      job: summary,
      accepted: created.map(toCandidateSummary),
      rejected,
      acceptedCount: created.length,
      rejectedCount: rejected.length,
      creditsReserved: reservation.reservedCredits,
      reservationId: reservation.id,
    };
  }

  async listCandidates(input: {
    userId: string;
    jobId: string;
    page: number;
    pageSize: number;
  }): Promise<ScreeningCandidateList> {
    const job = await this.repository.findJobById(input.jobId);
    if (!job || job.userId !== input.userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }

    const { items, total } = await this.repository.listCandidates({
      jobId: input.jobId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    return {
      items: items.map(toCandidateSummary),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }
}

export const screeningBatchService = new ScreeningBatchService();
