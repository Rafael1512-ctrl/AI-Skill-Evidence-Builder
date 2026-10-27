import {
  DEFAULT_ERROR_MESSAGES_ID,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  type ErrorCode,
} from '@aseb/shared';

export interface AppErrorOptions {
  /** Overrides the default Bahasa Indonesia message. */
  message?: string;
  /** Structured, non-sensitive context safe to return to the client. */
  details?: unknown;
  /** Original error, logged but never sent to the client. */
  cause?: unknown;
  /** Set false when the message must not reach the client (internal faults). */
  expose?: boolean;
}

/**
 * The single error type used across the API.
 *
 * Anything else that reaches the error middleware is treated as an unexpected
 * INTERNAL_ERROR and its message is withheld from production responses.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_ERROR_MESSAGES_ID[code]);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? true;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  static validation(details?: unknown, message?: string): AppError {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, { details, ...(message ? { message } : {}) });
  }

  static authenticationRequired(message?: string): AppError {
    return new AppError(ERROR_CODES.AUTHENTICATION_REQUIRED, message ? { message } : {});
  }

  static invalidCredentials(): AppError {
    return new AppError(ERROR_CODES.INVALID_CREDENTIALS);
  }

  static forbidden(message?: string): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, message ? { message } : {});
  }

  static notFound(message?: string): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, message ? { message } : {});
  }

  static conflict(message?: string): AppError {
    return new AppError(ERROR_CODES.CONFLICT, message ? { message } : {});
  }

  static rateLimited(message?: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.RATE_LIMITED, { details, ...(message ? { message } : {}) });
  }

  static insufficientCredits(required: number, available: number): AppError {
    return new AppError(ERROR_CODES.INSUFFICIENT_CREDITS, {
      message: `Kredit tidak cukup: dibutuhkan ${required} kredit, tersedia ${available} kredit.`,
      details: { required, available, shortfall: Math.max(0, required - available) },
    });
  }

  static unsupportedFile(message?: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.UNSUPPORTED_FILE, { details, ...(message ? { message } : {}) });
  }

  static fileTooLarge(message?: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.FILE_TOO_LARGE, { details, ...(message ? { message } : {}) });
  }

  static textExtractionFailed(details?: unknown): AppError {
    return new AppError(ERROR_CODES.TEXT_EXTRACTION_FAILED, { details });
  }

  static aiProvider(message?: string, cause?: unknown): AppError {
    return new AppError(ERROR_CODES.AI_PROVIDER_ERROR, { message, cause });
  }

  static aiRateLimited(cause?: unknown): AppError {
    return new AppError(ERROR_CODES.AI_RATE_LIMITED, { cause });
  }

  static aiInvalidResponse(details?: unknown, cause?: unknown): AppError {
    return new AppError(ERROR_CODES.AI_INVALID_RESPONSE, { details, cause });
  }

  static payment(message?: string, cause?: unknown): AppError {
    return new AppError(ERROR_CODES.PAYMENT_ERROR, { message, cause });
  }

  static jobNotFound(): AppError {
    return new AppError(ERROR_CODES.JOB_NOT_FOUND);
  }

  static upstream(message?: string, cause?: unknown): AppError {
    return new AppError(ERROR_CODES.UPSTREAM_UNAVAILABLE, { message, cause });
  }

  static internal(cause?: unknown): AppError {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, { cause, expose: false });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalises anything thrown into an AppError, logging the original cause. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return AppError.internal(error);
}
