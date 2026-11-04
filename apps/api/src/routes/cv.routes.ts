import { Router } from 'express';
import {
  cvExportRequestSchema,
  enhanceCvUploadBodySchema,
  paginationQuerySchema,
} from '@aseb/shared';
import { z } from 'zod';

import {
  auditCv,
  deleteDocument,
  enhanceCv,
  exportEnhancement,
  getAnalysis,
  getAuditUsage,
  getEnhancement,
  getHistory,
  listTemplates,
  testRoute,
} from '../controllers/cv.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadSinglePdf } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

export const cvRouter = Router();

/** Preserved from the original prototype so existing clients do not break. */
cvRouter.get('/test', testRoute);

cvRouter.get('/templates', listTemplates);

/**
 * CV audit.
 *
 * Authentication is mandatory. The service gives each account five free audits per
 * Jakarta calendar day, then reserves and settles the `CV_DEEP_ANALYSIS` price.
 */
cvRouter.get('/audit/usage', requireAuth(), getAuditUsage);

cvRouter.post('/audit', requireAuth(), uploadSinglePdf, auditCv);

cvRouter.get('/history', requireAuth(), validate({ query: paginationQuerySchema }), getHistory);

/**
 * Paid CV enhancement.
 *
 * Authenticated only: credits must be reserved before the model call. The PDF is the
 * `file` field and `options` is a JSON string field (see `enhanceCvUploadBodySchema`).
 */
cvRouter.post(
  '/enhance',
  requireAuth(),
  uploadSinglePdf,
  validate({ body: enhanceCvUploadBodySchema }),
  enhanceCv,
);

cvRouter.get(
  '/enhancements/:enhancementId',
  requireAuth(),
  validate({ params: z.object({ enhancementId: z.string().min(1).max(64) }) }),
  getEnhancement,
);

/** Paid PDF export of a completed enhancement (CV_PDF_EXPORT, 1 credit by default). */
cvRouter.post(
  '/enhancements/:enhancementId/export',
  requireAuth(),
  validate({
    params: z.object({ enhancementId: z.string().min(1).max(64) }),
    // `.default({})` keeps a body-less POST (no template override) valid.
    body: cvExportRequestSchema.default({}),
  }),
  exportEnhancement,
);

cvRouter.get(
  '/analyses/:analysisId',
  requireAuth(),
  validate({ params: z.object({ analysisId: z.string().min(1).max(64) }) }),
  getAnalysis,
);

cvRouter.delete(
  '/documents/:documentId',
  requireAuth(),
  validate({ params: z.object({ documentId: z.string().min(1).max(64) }) }),
  deleteDocument,
);
