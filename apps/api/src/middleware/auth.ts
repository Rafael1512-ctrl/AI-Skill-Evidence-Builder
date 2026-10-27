import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { authService, type AuthContext } from '../services/auth.service.js';
import { AppError } from '../utils/errors.js';

function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim().length > 0 ? token.trim() : null;
}

/** Attaches `req.auth` when a valid token is present; never rejects. */
export function optionalAuth(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      req.auth = null;
      next();
      return;
    }

    try {
      req.auth = await authService.authenticateBearer(token);
    } catch {
      // An invalid token on a public route is treated as "not signed in".
      req.auth = null;
    }
    next();
  };
}

/** Requires a valid session. */
export function requireAuth(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      next(AppError.authenticationRequired());
      return;
    }

    try {
      req.auth = await authService.authenticateBearer(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Admin authorization.
 *
 * `/admin` in the UI is a convenience only: this middleware is the actual boundary,
 * and it re-checks the role on every request from the database-backed context rather
 * than trusting a claim in the token.
 */
export function requireAdmin(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) {
      next(AppError.authenticationRequired());
      return;
    }
    if (auth.role !== 'ADMIN') {
      next(AppError.forbidden('Akses khusus administrator.'));
      return;
    }
    next();
  };
}

export function currentAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw AppError.authenticationRequired();
  }
  return req.auth;
}
