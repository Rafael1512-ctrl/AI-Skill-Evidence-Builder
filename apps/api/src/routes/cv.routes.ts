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
  getEnhancement,
  getHistory,
  listTemplates,
  testRoute,
} from '../controllers/cv.controller.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { clientIp, rateLimit } from '../middleware/rate-limit.js';
import { uploadSinglePdf } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { env } from '../config/env.js';

export const cvRouter = Router();

/** Preserved from the original prototype so existing clients do not break. */
cvRouter.get('/test', testRoute);

cvRouter.get('/templates', listTemplates);

/**
 * Free CV audit.
 *
 * Guests are allowed (0 credits) but limited per IP; authenticated users are limited
 * more generously because their usage is attributable.
 */
cvRouter.post(
  '/audit',
  optionalAuth(),
  rateLimit({
    scope: 'cv-audit',
    windowMs: env.GUEST_AUDIT_RATE_WINDOW_MINUTES * 60_000,
    max: env.GUEST_AUDIT_RATE_LIMIT,
    keyGenerator: (req) => req.auth?.userId ?? clientIp(req),
    message:
      'Batas audit CV gratis tercapai untuk saat ini. Silakan daftar untuk melanjutkan atau coba lagi nanti.',
  }),
  uploadSinglePdf,
  auditCv,
);

cvRouter.get(
  '/history',
  requireAuth(),
  validate({ query: paginationQuerySchema }),
  getHistory,
);

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
