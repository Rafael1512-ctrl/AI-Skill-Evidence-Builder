import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { logger } from '../utils/logger.js';

/** Assigns a request id and a request-scoped logger. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();

  req.requestId = requestId;
  req.auth = null;
  req.log = logger.child({ requestId });
  res.setHeader('x-request-id', requestId);
  next();
}
