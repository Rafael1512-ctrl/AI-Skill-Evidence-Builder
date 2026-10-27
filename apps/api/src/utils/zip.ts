import { fromBufferPromise, type Entry, type ZipFile } from 'yauzl';

import type { ErrorCode } from '@aseb/shared';

import { AppError } from './errors.js';
import { hasZipSignature } from './file-validation.js';
import { safeFileName } from './text.js';

/**
 * ZIP handling for screening batches.
 *
 * A ZIP is UNTRUSTED INPUT: entry names, declared sizes and compression methods are all
 * attacker-controlled. Nothing is ever written to disk - entries are read into memory and
 * bounded - and every guard below rejects the whole archive rather than trying to salvage
 * a suspicious one.
 */

export interface ZipLimits {
  /** Maximum number of file entries (directories excluded). */
  maxEntries: number;
  /** Maximum total uncompressed bytes across all entries. */
  maxUncompressedBytes: number;
  /** Maximum uncompressed/compressed ratio for a single entry. */
  maxCompressionRatio: number;
  /** Maximum uncompressed bytes for a single entry (the per-PDF ceiling). */
  maxEntryBytes: number;
  /** Maximum number of PDF entries that may be accepted from one archive. */
  maxPdfFiles: number;
}

export interface ZipPdfFile {
  /** Sanitised, display-safe name derived from the entry path. */
  fileName: string;
  /** Original entry path, kept for the rejection report. */
  entryPath: string;
  sizeBytes: number;
  buffer: Buffer;
}

export interface ZipEntryRejection {
  fileName: string;
  code: ErrorCode;
  message: string;
}

export interface ZipExtractionResult {
  files: ZipPdfFile[];
  rejected: ZipEntryRejection[];
}

/** Metadata noise that operating systems add to archives - never a candidate CV. */
function isIgnoredEntry(entryPath: string): boolean {
  if (entryPath.startsWith('__MACOSX/')) return true;
  const baseName = entryPath.split('/').pop() ?? entryPath;
  return baseName.startsWith('._') || baseName === '.DS_Store' || baseName === 'Thumbs.db';
}

function isPdfEntry(entryPath: string): boolean {
  return /\.pdf$/i.test(entryPath);
}

/** Reads one entry into memory, refusing to grow past the per-file ceiling. */
function readEntry(zipfile: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error('ZIP entry stream missing'));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      let failed = false;

      stream.on('data', (chunk: Buffer) => {
        if (failed) return;
        size += chunk.length;
        if (size > maxBytes) {
          failed = true;
          stream.destroy();
          reject(
            AppError.fileTooLarge('Salah satu berkas di dalam ZIP melebihi batas 5 MB per PDF.', {
              entry: safeFileName(entry.fileName),
            }),
          );
          return;
        }
        chunks.push(chunk);
      });

      stream.on('error', (streamError: Error) => {
        if (failed) return;
        failed = true;
        reject(streamError);
      });

      stream.on('end', () => {
        if (failed) return;
        resolve(Buffer.concat(chunks));
      });
    });
  });
}

/** Drives yauzl's pull-based entry loop to completion. */
function walkEntries(zipfile: ZipFile, onEntry: (entry: Entry) => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error === undefined) resolve();
      else reject(error);
    };

    zipfile.on('entry', (entry: Entry) => {
      void onEntry(entry)
        .then(() => {
          if (!settled) zipfile.readEntry();
        })
        .catch((error: unknown) => finish(error));
    });
    zipfile.on('end', () => finish());
    zipfile.on('error', (error: Error) => finish(error));
    zipfile.readEntry();
  });
}

/**
 * Extracts every PDF entry from a ZIP buffer with zip-bomb and path guards.
 *
 * Archive-level violations (entry count, total size, compression ratio, encryption,
 * corruption) abort the whole batch with an `AppError`. Per-entry problems that are
 * recoverable - a non-PDF file, or a single oversized PDF - are reported in `rejected`
 * so the rest of the batch can still succeed.
 */
export async function extractPdfEntriesFromZip(
  buffer: Buffer,
  limits: ZipLimits,
): Promise<ZipExtractionResult> {
  if (!hasZipSignature(buffer)) {
    throw AppError.unsupportedFile('Berkas ini bukan arsip ZIP yang valid.', {
      fileName: 'upload.zip',
    });
  }

  let zipfile: ZipFile;
  try {
    zipfile = await fromBufferPromise(buffer);
  } catch (error) {
    throw AppError.unsupportedFile('Arsip ZIP rusak atau tidak dapat dibaca.', {
      reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
  }

  const files: ZipPdfFile[] = [];
  const rejected: ZipEntryRejection[] = [];
  let entryCount = 0;
  let totalUncompressedBytes = 0;

  try {
    await walkEntries(zipfile, async (entry) => {
      const entryPath = entry.fileName;
      if (entryPath.endsWith('/')) return;
      if (isIgnoredEntry(entryPath)) return;

      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw AppError.unsupportedFile(
          `Arsip berisi terlalu banyak berkas. Maksimal ${limits.maxEntries} entri.`,
          { entryCount: limits.maxEntries },
        );
      }

      if (entry.isEncrypted()) {
        throw AppError.unsupportedFile('Arsip ZIP terenkripsi atau dilindungi kata sandi.', {
          entry: safeFileName(entryPath),
        });
      }

      const uncompressed = entry.uncompressedSize;
      const compressed = Math.max(1, entry.compressedSize);

      if (uncompressed / compressed > limits.maxCompressionRatio) {
        throw AppError.unsupportedFile('Arsip ZIP ditolak karena rasio kompresinya tidak wajar.', {
          entry: safeFileName(entryPath),
        });
      }

      totalUncompressedBytes += uncompressed;
      if (totalUncompressedBytes > limits.maxUncompressedBytes) {
        throw AppError.fileTooLarge(
          'Total isi ZIP melebihi batas yang diizinkan setelah diekstrak.',
          { maxUncompressedBytes: limits.maxUncompressedBytes },
        );
      }

      const fileName = safeFileName(entryPath.split('/').pop() ?? entryPath);

      if (!isPdfEntry(entryPath)) {
        rejected.push({
          fileName,
          code: 'UNSUPPORTED_FILE',
          message: 'Hanya berkas PDF di dalam ZIP yang diproses.',
        });
        return;
      }

      if (uncompressed > limits.maxEntryBytes) {
        rejected.push({
          fileName,
          code: 'FILE_TOO_LARGE',
          message: 'Berkas ini melebihi batas 5 MB per PDF.',
        });
        return;
      }

      if (files.length >= limits.maxPdfFiles) {
        throw AppError.validation(
          { maxFiles: limits.maxPdfFiles },
          `Batch maksimal berisi ${limits.maxPdfFiles} CV.`,
        );
      }

      const entryBuffer = await readEntry(zipfile, entry, limits.maxEntryBytes);
      files.push({
        fileName,
        entryPath,
        sizeBytes: entryBuffer.byteLength,
        buffer: entryBuffer,
      });
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unsupportedFile('Arsip ZIP rusak atau tidak dapat dibaca.', {
      reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
  } finally {
    zipfile.close();
  }

  return { files, rejected };
}
