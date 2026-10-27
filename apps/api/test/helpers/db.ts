import { createServer } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { pricingService } from '../../src/services/pricing.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../prisma/migrations');

export interface TestDatabase {
  /** TCP URL that speaks the PostgreSQL wire protocol. */
  url: string;
  /** Direct handle, useful for raw SQL assertions. */
  pglite: PGlite;
  /** Truncates every table and re-seeds nothing. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

let shared: TestDatabase | null = null;
let sharedClient: PrismaClient | null = null;
let refCount = 0;

function migrationSql(): string {
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return folders
    .map((folder) => readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8'))
    .join('\n');
}

/** Sandboxed environments deny binding a local port; make that actionable. */
function explainBindFailure(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EPERM' || code === 'EACCES') {
    return new Error(
      [
        'The test database could not bind a local TCP port (EACCES/EPERM).',
        'This happens inside restricted sandboxes that forbid listening sockets.',
        'Fix it by running the suite where listening sockets are allowed (a normal shell, or a',
        'CI runner). PGlite is the only supported test database today: TEST_DATABASE_URL is',
        'documented elsewhere but not implemented yet (PROJECT_CONTEXT.md section 8.47).',
      ].join('\n'),
    );
  }
  return error as Error;
}

/** Migrations are applied directly; a real Postgres target gets the migration SQL too. */
async function applyMigrations(pglite: PGlite): Promise<void> {
  await pglite.exec(migrationSql());
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        probe.close(() => resolvePort(port));
        return;
      }
      probe.close(() => reject(new Error('Could not allocate a TCP port for the test database.')));
    });
  });
}

async function tableNames(pglite: PGlite): Promise<string[]> {
  const result = await pglite.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  return result.rows.map((row) => row.tablename);
}

/**
 * Boots a real PostgreSQL-compatible database in-process.
 *
 * PGlite is PostgreSQL compiled to WebAssembly, reachable over the wire protocol, so
 * integration tests exercise the actual migration SQL and real SQL semantics
 * (types, constraints, unique indexes, row locking) without Docker or a server.
 * Queries are serialised by PGlite, so tests validate invariants rather than
 * genuine parallel interleaving.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  if (shared) {
    refCount += 1;
    return shared;
  }

  process.env.NODE_ENV = 'test';

  const pglite = new PGlite();
  await pglite.waitReady;
  await applyMigrations(pglite);

  const port = await findFreePort();
  const socket = new PGLiteSocketServer({
    db: pglite,
    port,
    host: '127.0.0.1',
    // The Prisma pool is capped at ONE connection (see below) so BEGIN and ROLLBACK
    // can never land on different sessions. The server still accepts a replacement
    // connection, because Prisma discards a connection after a query error and a
    // strict limit of 1 would leave the client unable to reconnect.
    maxConnections: 10,
  });
  try {
    await socket.start();
  } catch (error) {
    await pglite.close();
    throw explainBindFailure(error);
  }

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;

  const database: TestDatabase = {
    url,
    pglite,
    async reset() {
      const tables = await tableNames(pglite);
      if (tables.length > 0) {
        const quoted = tables.map((table) => `"${table}"`).join(', ');
        await pglite.exec(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
      }

      // Truncating `feature_pricing` is not enough: the pricing service memoises overrides for
      // 30 seconds in a process-wide singleton, so a price written by an earlier test file would
      // leak into every later file (a 7-credit override made a 5-credit enhancement look
      // unaffordable). Resetting the database must reset that cache too.
      pricingService.invalidate();
    },
    async close() {
      await socket.stop();
      await pglite.close();
    },
  };

  shared = database;
  refCount = 1;
  return database;
}

/** Registers the PGlite URL as DATABASE_URL and returns a Prisma client bound to it. */
export async function useTestDatabase(): Promise<{
  db: TestDatabase;
  prisma: PrismaClient;
}> {
  const db = await startTestDatabase();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = db.url;
  process.env.AUTH_DEV_JWT_SECRET = process.env.AUTH_DEV_JWT_SECRET ?? 'test-secret';

  const { resetEnvCache } = await import('../../src/config/env.js');
  resetEnvCache();

  const { createPrismaClient, setPrismaClientForTests } = await import('../../src/db/prisma.js');

  if (!sharedClient) {
    sharedClient = createPrismaClient({ connectionString: db.url, maxConnections: 1 });
    setPrismaClientForTests(sharedClient);
  }

  return { db, prisma: sharedClient };
}

/** Closes the shared database. Call from the last suite that uses it. */
export async function stopTestDatabase(): Promise<void> {
  refCount -= 1;
  if (refCount > 0 || !shared) return;

  if (sharedClient) {
    await sharedClient.$disconnect();
    sharedClient = null;
    const { setPrismaClientForTests } = await import('../../src/db/prisma.js');
    setPrismaClientForTests(null);
  }

  await shared.close();
  shared = null;
  refCount = 0;
}
