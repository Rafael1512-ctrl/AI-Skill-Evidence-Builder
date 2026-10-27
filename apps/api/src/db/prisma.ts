import { PrismaPg } from '@prisma/adapter-pg';

import { ERROR_CODES } from '@aseb/shared';

import { env, hasDatabaseUrl } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../utils/errors.js';

/**
 * Prisma client access.
 *
 * Prisma 7 requires a driver adapter, so the connection is created from
 * DATABASE_URL through `@prisma/adapter-pg`. Construction is lazy: modules can
 * import this file in environments without a database (health checks, unit tests,
 * tooling) without crashing at import time.
 */
export interface PrismaConnectionOptions {
  connectionString: string;
  maxConnections?: number;
}

let client: PrismaClient | null = null;

export function createPrismaClient(options: PrismaConnectionOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    // Keep test runs fast when a worker is torn down mid-query.
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
  });
  return new PrismaClient({
    adapter,
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
  });
}

export function getPrisma(): PrismaClient {
  if (client) return client;
  if (!hasDatabaseUrl()) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, {
      message:
        'DATABASE_URL is not configured. Set it in .env (see .env.example) before using database-backed features.',
      expose: false,
    });
  }
  client = createPrismaClient({ connectionString: env.DATABASE_URL as string });
  return client;
}

export function isDatabaseConfigured(): boolean {
  return hasDatabaseUrl();
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return;
  const current = client;
  client = null;
  await current.$disconnect();
}

/** Test-only hook: inject a pre-built client (used by the PGlite harness). */
export function setPrismaClientForTests(next: PrismaClient | null): void {
  client = next;
}
