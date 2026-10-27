import { Router } from 'express';
import {
  createTestimonialSchema,
  paginationQuerySchema,
  shortTextSchema,
  testimonialModerationQuerySchema,
  testimonialModerationSchema,
} from '@aseb/shared';
import { z } from 'zod';

import {
  listMyTestimonials,
  listPublicTestimonials,
  listTestimonialsForModeration,
  moderateTestimonial,
  submitTestimonial,
} from '../controllers/testimonial.controller.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const testimonialIdParamSchema = z.object({ testimonialId: shortTextSchema });

/** Reviews are cheap to write and expensive to moderate, so each account gets a daily cap. */
const TESTIMONIAL_DAILY_LIMIT = 5;

/**
 * Testimonials.
 *
 * Submission needs a session; reading the approved list is public; moderation is enforced
 * server-side by `requireAuth` + `requireAdmin`, never by hiding a route: `requireAdmin` only
 * reads the context that `requireAuth` puts on the request, so mounting it alone would answer 401
 * to everybody, admins included. The moderation paths are declared before `/:testimonialId` so
 * `/moderation` is never parsed as an id.
 */
export const testimonialRouter = Router();

testimonialRouter.get('/', validate({ query: paginationQuerySchema }), listPublicTestimonials);
testimonialRouter.get(
  '/moderation',
  requireAuth(),
  requireAdmin(),
  validate({ query: testimonialModerationQuerySchema }),
  listTestimonialsForModeration,
);
testimonialRouter.get(
  '/mine',
  requireAuth(),
  validate({ query: paginationQuerySchema }),
  listMyTestimonials,
);
testimonialRouter.post(
  '/',
  requireAuth(),
  rateLimit({
    scope: 'testimonial-submit',
    windowMs: 24 * 60 * 60 * 1_000,
    max: TESTIMONIAL_DAILY_LIMIT,
    keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
    message: 'Batas pengiriman testimoni harian tercapai. Coba lagi besok.',
  }),
  validate({ body: createTestimonialSchema }),
  submitTestimonial,
);
testimonialRouter.patch(
  '/:testimonialId/moderation',
  requireAuth(),
  requireAdmin(),
  validate({ params: testimonialIdParamSchema, body: testimonialModerationSchema }),
  moderateTestimonial,
);
