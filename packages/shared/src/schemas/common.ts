import { z } from 'zod';

import { ERROR_CODES } from '../constants/error-codes.js';

export const idSchema = z.string().trim().min(1).max(64);

export const emailSchema = z.email().max(320).toLowerCase();

export const isoDateTimeSchema = z.iso.datetime();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const errorCodeSchema = z.enum(
  Object.values(ERROR_CODES) as [string, ...string[]],
);

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export const apiSuccessBodySchema = z.object({
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** A short human label that is safe to render in the UI. */
export const shortTextSchema = z.string().trim().min(1).max(200);

export const longTextSchema = z.string().trim().min(1).max(20_000);

export const urlSchema = z.url().max(2048);

/**
 * An optional URL where an empty string is normalised to "not provided", so a form
 * input left blank never fails validation.
 */
export const optionalUrlSchema = z
  .union([urlSchema, z.literal('')])
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export function paginate(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
