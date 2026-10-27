import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

import { AppError } from '../utils/errors.js';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function parse<T>(schema: ZodType<T>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw AppError.validation(
      result.error.issues.slice(0, 10).map((issue) => ({
        where,
        path: issue.path.join('.'),
        message: issue.message,
      })),
      'Data yang dikirim tidak valid.',
    );
  }
  return result.data;
}

/**
 * Validates and coerces request input with Zod.
 *
 * Parsed values are stored on `req.validated` rather than mutating `req.body`, so the
 * behaviour of Express' own getters is unchanged. Express 5 routes async rejections to
 * the error middleware automatically.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const validated: NonNullable<Request['validated']> = {};

    if (schemas.params) validated.params = parse(schemas.params, req.params, 'params');
    if (schemas.query) validated.query = parse(schemas.query, req.query, 'query');
    if (schemas.body) validated.body = parse(schemas.body, req.body, 'body');

    req.validated = validated;
    next();
  };
}

/** Typed accessors for validated input (the schemas guarantee the shape). */
export function validatedBody<T>(req: Request): T {
  if (!req.validated?.body) {
    throw AppError.internal(new Error('validate() middleware did not run for this route'));
  }
  return req.validated.body as T;
}

export function validatedQuery<T>(req: Request): T {
  if (!req.validated?.query) {
    throw AppError.internal(new Error('validate() middleware did not run for this route'));
  }
  return req.validated.query as T;
}

export function validatedParams<T>(req: Request): T {
  if (!req.validated?.params) {
    throw AppError.internal(new Error('validate() middleware did not run for this route'));
  }
  return req.validated.params as T;
}
