import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const prismaCli = resolve(apiRoot, '../../node_modules/prisma/build/index.js');

/**
 * End-to-end check of the real deployment path.
 *
 * `prisma migrate deploy` is what runs against Supabase/CI, and it is a different
 * code path from the harness that concatenates `migration.sql` by hand: it owns the
 * `_prisma_migrations` history table and the migration checksums. This test boots a
 * PostgreSQL-wire server, runs the actual CLI against it and asserts the migration
 * was applied and recorded.
 *
 * A live Supabase instance is still required before production deployment; this
 * proves the command, the migration and the config wiring are correct.
 */
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
      probe.close(() => reject(new Error('Could not allocate a TCP port for the deploy test.')));
    });
  });
}

interface DeployResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Async spawn is required: PGlite answers the socket from this event loop, so a
 * blocking `spawnSync` would deadlock the migration engine.
 */
function runPrismaDeploy(databaseUrl: string): Promise<DeployResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DIRECT_URL: databaseUrl,
        CHECKPOINT_DISABLE: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

describe('prisma migrate deploy', () => {
  let pglite: PGlite;
  let socket: PGLiteSocketServer;
  let result: DeployResult;

  beforeAll(async () => {
    const port = await findFreePort();
    pglite = new PGlite();
    await pglite.waitReady;

    socket = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 5 });
    await socket.start();

    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
    result = await runPrismaDeploy(url);
  }, 120_000);

  afterAll(async () => {
    await socket?.stop();
    await pglite?.close();
  });

  it('applies the committed migration without error', () => {
    expect(result.stderr).not.toContain('P1001');
    expect(result.code, `deploy failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('20260926000000_init');
    expect(result.stdout).toContain('All migrations have been successfully applied');
  });

  it('records the migration in the Prisma history table', async () => {
    const applied = await pglite.query<{ migration_name: string; applied: boolean }>(
      'select migration_name, finished_at is not null as applied from _prisma_migrations',
    );

    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0]).toMatchObject({ migration_name: '20260926000000_init', applied: true });
  });

  it('creates the expected tables in the target database', async () => {
    const tables = await pglite.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );

    // 23 application tables plus _prisma_migrations.
    expect(tables.rows[0]?.n).toBe(24);

    const spotCheck = await pglite.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename in ('users', 'credit_wallets', 'screening_jobs') order by tablename`,
    );
    expect(spotCheck.rows.map((row) => row.tablename)).toEqual([
      'credit_wallets',
      'screening_jobs',
      'users',
    ]);
  });
});
