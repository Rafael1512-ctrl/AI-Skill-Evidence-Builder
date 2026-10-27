import { z } from 'zod';

import { TESTIMONIAL_STATUSES } from '../constants/workflow.js';

export const createTestimonialSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(10).max(1000),
  /** Optional link back to the enhancement that prompted the review. */
  enhancementId: z.string().trim().max(64).optional(),
  displayName: z.string().trim().max(80).optional(),
});

export type CreateTestimonialInput = z.infer<typeof createTestimonialSchema>;

export const testimonialModerationSchema = z.object({
  status: z.enum(TESTIMONIAL_STATUSES),
});

export type TestimonialModerationInput = z.infer<typeof testimonialModerationSchema>;

export const testimonialSchema = z.object({
  id: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string(),
  displayName: z.string(),
  status: z.enum(TESTIMONIAL_STATUSES),
  createdAt: z.string(),
  moderatedAt: z.string().nullable(),
});

export type Testimonial = z.infer<typeof testimonialSchema>;

export const publicTestimonialSchema = testimonialSchema.pick({
  id: true,
  rating: true,
  comment: true,
  displayName: true,
  createdAt: true,
});

export type PublicTestimonial = z.infer<typeof publicTestimonialSchema>;

export const publicTestimonialListSchema = z.object({
  items: z.array(publicTestimonialSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type PublicTestimonialList = z.infer<typeof publicTestimonialListSchema>;

/** The author's own list: status included, so the UI can say "menunggu moderasi". */
export const testimonialListSchema = z.object({
  items: z.array(testimonialSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type TestimonialList = z.infer<typeof testimonialListSchema>;

export const publicTestimonialListResponseSchema = z.object({
  testimonials: publicTestimonialListSchema,
});

export type PublicTestimonialListResponse = z.infer<typeof publicTestimonialListResponseSchema>;

export const testimonialListResponseSchema = z.object({
  testimonials: testimonialListSchema,
});

export type TestimonialListResponse = z.infer<typeof testimonialListResponseSchema>;

export const testimonialResponseSchema = z.object({ testimonial: testimonialSchema });

export type TestimonialResponse = z.infer<typeof testimonialResponseSchema>;

/** Moderation queue filter; omit `status` for everything. */
export const testimonialModerationQuerySchema = z.object({
  status: z.enum(TESTIMONIAL_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type TestimonialModerationQuery = z.infer<typeof testimonialModerationQuerySchema>;
