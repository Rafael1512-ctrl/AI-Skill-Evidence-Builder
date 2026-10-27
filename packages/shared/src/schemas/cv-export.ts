import { z } from 'zod';

import { CV_TEMPLATE_KEYS } from '../constants/workflow.js';

/**
 * `POST /api/cv/enhancements/:enhancementId/export`
 *
 * The template is optional: without it the export reuses the template stored on the
 * enhancement. Choosing another one only changes layout, never the document content.
 */
export const cvExportRequestSchema = z.object({
  templateKey: z.enum(CV_TEMPLATE_KEYS).optional(),
});

export type CvExportRequest = z.infer<typeof cvExportRequestSchema>;

/**
 * A rendered CV export.
 *
 * `contentBase64` carries the PDF bytes inside the standard JSON envelope. There is no
 * storage provider yet (`SUPABASE_STORAGE_ENABLED=false`), so bytes are returned inline
 * rather than behind a signed URL; a CV PDF is small and base64 keeps every response on
 * the same Zod-validated contract as the rest of the API.
 */
export const cvExportResultSchema = z.object({
  documentId: z.string(),
  enhancementId: z.string(),
  templateKey: z.enum(CV_TEMPLATE_KEYS),
  fileName: z.string().min(1).max(255),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number().int().min(0),
  pageCount: z.number().int().min(0),
  creditsCharged: z.number().int().min(0),
  contentBase64: z.string().min(1),
  createdAt: z.string(),
});

export type CvExportResult = z.infer<typeof cvExportResultSchema>;

export const cvExportResponseSchema = z.object({ export: cvExportResultSchema });

export type CvExportResponse = z.infer<typeof cvExportResponseSchema>;
