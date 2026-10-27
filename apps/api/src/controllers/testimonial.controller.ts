import type { Request, Response } from 'express';

import type {
  CreateTestimonialInput,
  PaginationQuery,
  TestimonialModerationInput,
  TestimonialModerationQuery,
} from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.js';
import { testimonialService } from '../services/testimonial.service.js';

/** POST /api/testimonials - submits a review for moderation (PENDING). */
export async function submitTestimonial(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const body = validatedBody<CreateTestimonialInput>(req);

  const testimonial = await testimonialService.submit({ userId: auth.userId, body });
  res.status(201).json({ data: { testimonial } });
}

/** GET /api/testimonials - public: approved reviews only, no session required. */
export async function listPublicTestimonials(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery>(req);

  const testimonials = await testimonialService.listPublic({
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: { testimonials },
    meta: { page: testimonials.page, pageSize: testimonials.pageSize, total: testimonials.total },
  });
}

/** GET /api/testimonials/mine - the caller's own reviews, status included. */
export async function listMyTestimonials(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const query = validatedQuery<PaginationQuery>(req);

  const testimonials = await testimonialService.listMine({
    userId: auth.userId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: { testimonials },
    meta: { page: testimonials.page, pageSize: testimonials.pageSize, total: testimonials.total },
  });
}

/** GET /api/testimonials/moderation - admin only: the moderation queue. */
export async function listTestimonialsForModeration(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<TestimonialModerationQuery>(req);

  const testimonials = await testimonialService.listForModeration(query);

  res.json({
    data: { testimonials },
    meta: { page: testimonials.page, pageSize: testimonials.pageSize, total: testimonials.total },
  });
}

/** PATCH /api/testimonials/:testimonialId/moderation - admin only: approve or reject. */
export async function moderateTestimonial(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { testimonialId } = validatedParams<{ testimonialId: string }>(req);
  const body = validatedBody<TestimonialModerationInput>(req);

  const testimonial = await testimonialService.moderate({
    testimonialId,
    moderatorId: auth.userId,
    body,
  });

  res.json({ data: { testimonial } });
}
