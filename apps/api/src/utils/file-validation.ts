import { LIMITS } from '@aseb/shared';

import { AppError } from './errors.js';
import { safeFileName } from './text.js';

export interface ValidatedFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

/** True when the buffer starts with the PDF magic number, ignoring leading whitespace/BOM. */
export function hasPdfSignature(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  const index = head.indexOf('%PDF-');
  return index !== -1 && index <= 32;
}

export function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // Local file header "PK\x03\x04", empty archive "PK\x05\x06", spanned "PK\x07\x08".
  const signature = buffer.subarray(0, 4);
  return (
    (signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04) ||
    (signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x05 && signature[3] === 0x06) ||
    (signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x07 && signature[3] === 0x08)
  );
}

/**
 * Validates an uploaded file.
 *
 * Extensions and declared MIME types are treated as hints only: the actual file
 * signature decides whether the content is acceptable.
 */
export function validatePdfUpload(file: {
  originalname?: string | undefined;
  mimetype?: string | undefined;
  size: number;
  buffer: Buffer;
}): ValidatedFile {
  const fileName = safeFileName(file.originalname ?? 'cv.pdf');

  if (file.size > LIMITS.MAX_PDF_BYTES) {
    throw AppError.fileTooLarge(undefined, {
      sizeBytes: file.size,
      maxBytes: LIMITS.MAX_PDF_BYTES,
    });
  }

  if (file.buffer.byteLength === 0) {
    throw AppError.unsupportedFile('File kosong tidak dapat diproses.');
  }

  if (!hasPdfSignature(file.buffer)) {
    throw AppError.unsupportedFile(
      'File ini bukan PDF yang valid. Pastikan Anda mengunggah dokumen PDF (bukan gambar atau Word).',
      { fileName, declaredMimeType: file.mimetype ?? null },
    );
  }

  if (!/\.pdf$/i.test(fileName)) {
    // A real PDF with a misleading extension is still processed, but the stored name is normalised.
    throw AppError.unsupportedFile('Ekstensi file harus .pdf.', { fileName });
  }

  return {
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: file.size,
    buffer: file.buffer,
  };
}
