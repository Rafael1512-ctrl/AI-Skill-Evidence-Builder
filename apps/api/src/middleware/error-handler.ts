import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';

import { DEFAULT_ERROR_MESSAGES_ID, ERROR_CODES, type ApiErrorBody } from '@aseb/shared';

import { env } from '../config/env.js';
import { AppError, isAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function fromZod(error: ZodError): AppError {
  return AppError.validation(
    error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
    'Data yang dikirim tidak valid.',
  );
}

function fromMulter(error: MulterError): AppError {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return AppError.fileTooLarge();
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    return AppError.validation({ multerCode: error.code }, 'Jumlah atau nama field file tidak sesuai.');
  }
  return AppError.validation({ multerCode: error.code }, 'Berkas tidak dapat diproses.');
}

/**
 * Central error handler.
 *
 * Client-safe messages are returned for application errors; anything unexpected is
 * logged and reduced to a generic message, so stack traces and internal details never
 * leak to production clients.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = isAppError(error)
    ? error
    : error instanceof ZodError
      ? fromZod(error)
      : error instanceof MulterError
        ? fromMulter(error)
        : AppError.internal(error);

  const log = req.log ?? logger;
  const context = { requestId: req.requestId, code: appError.code, path: req.originalUrl, method: req.method };

  if (appError.status >= 500) {
    log.error({ ...context, err: appError.cause ?? appError }, 'Request failed');
  } else {
    log.warn(context, 'Request rejected');
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : DEFAULT_ERROR_MESSAGES_ID[ERROR_CODES.INTERNAL_ERROR],
      ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
      requestId: req.requestId,
    },
  };

  if (env.isDevelopment && appError.cause instanceof Error && appError.status >= 500) {
    body.error.details = { developerMessage: appError.cause.message };
  }

  res.status(appError.status).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: DEFAULT_ERROR_MESSAGES_ID.NOT_FOUND,
      requestId: req.requestId,
    },
  };
  res.status(404).json(body);
}
