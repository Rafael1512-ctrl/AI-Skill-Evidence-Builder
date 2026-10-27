import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp, type Options as PinoHttpOptions } from 'pino-http';

import { LIMITS } from '@aseb/shared';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestContext } from './middleware/request-context.js';
import { apiRouter } from './routes/index.js';
import { logger } from './utils/logger.js';

/** CORS allowlist: the configured frontend plus any explicit extra origins. */
function originHandler(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
  // Same-origin or server-to-server requests have no Origin header.
  if (!origin) {
    callback(null, true);
    return;
  }
  if (env.allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(null, false);
}

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` so tests can drive the app with Supertest without
 * binding a port, and so the same app can be reused by future serverless adapters.
 */
const httpLoggerOptions: PinoHttpOptions = {
  logger,
  genReqId: (req) => (req as { requestId?: string }).requestId ?? 'unknown',
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },
};

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind a reverse proxy the first hop is the real client, which matters for rate limits.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false, // the API serves JSON only; the web app sets its own policy
    }),
  );
  app.use(
    cors({
      origin: originHandler,
      credentials: true,
      maxAge: 600,
      exposedHeaders: ['x-request-id', 'retry-after'],
    }),
  );

  // Request id + request-scoped logger, before anything can log.
  app.use(requestContext);
  app.use(pinoHttp(httpLoggerOptions));

  app.use(express.json({ limit: LIMITS.MAX_JSON_BODY_BYTES }));
  app.use(express.urlencoded({ extended: false, limit: LIMITS.MAX_JSON_BODY_BYTES }));

  app.get('/', (_req, res) => {
    res.json({
      data: {
        name: 'AI Skill Evidence Builder API',
        version: process.env.npm_package_version ?? '0.1.0',
        docs: '/api/health',
      },
    });
  });

  app.use(
    '/api',
    rateLimit({
      scope: 'api',
      windowMs: 60_000,
      max: env.API_RATE_LIMIT_PER_MINUTE,
      message: 'Terlalu banyak permintaan ke API. Silakan coba lagi sebentar lagi.',
    }),
    apiRouter,
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
