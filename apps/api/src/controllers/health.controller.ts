import type { Request, Response } from 'express';

import { env } from '../config/env.js';
import { isDatabaseConfigured, getPrisma } from '../db/prisma.js';

interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  environment: string;
  uptimeSeconds: number;
  database: 'connected' | 'unavailable' | 'not_configured';
  queue: 'bullmq' | 'in-process';
  aiProvider: string;
  paymentProvider: string;
  warnings: string[];
}

/**
 * Liveness and readiness in one endpoint.
 *
 * Deliberately dependency-light: it must answer even when optional integrations are
 * missing, while still reporting them honestly.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  let database: HealthPayload['database'] = 'not_configured';

  if (isDatabaseConfigured()) {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'unavailable';
    }
  }

  const payload: HealthPayload = {
    status: database === 'unavailable' ? 'degraded' : 'ok',
    version: process.env.npm_package_version ?? '0.1.0',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    database,
    queue: env.REDIS_URL ? 'bullmq' : 'in-process',
    aiProvider: env.AI_PROVIDER,
    paymentProvider: env.PAYMENT_PROVIDER,
    warnings: env.warnings,
  };

  res.status(database === 'unavailable' ? 503 : 200).json({ data: payload });
}
