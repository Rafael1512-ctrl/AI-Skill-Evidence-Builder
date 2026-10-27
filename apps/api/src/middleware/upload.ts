import multer from 'multer';

import { LIMITS } from '@aseb/shared';

/**
 * Upload handling.
 *
 * Files are kept in memory: CV text is extracted immediately and the original binary is
 * only persisted when the product needs it (Supabase Storage), which keeps anonymous
 * uploads genuinely ephemeral.
 */
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_PDF_BYTES,
    files: 1,
    fields: 10,
  },
});

const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_BATCH_ZIP_BYTES,
    files: LIMITS.MAX_SCREENING_CVS,
    fields: 10,
  },
});

/** A single PDF CV (free audit, enhancement source, single candidate upload). */
export const uploadSinglePdf = pdfUpload.single('file');

/** Up to 50 PDFs, or one ZIP, for a screening batch. */
export const uploadBatch = batchUpload.array('files', LIMITS.MAX_SCREENING_CVS);
