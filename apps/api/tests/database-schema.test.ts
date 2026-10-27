import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Schema/migration guards for Phase 3.
 *
 * These do not need a database: they compare the two committed artifacts -
 * `schema.prisma` and the SQL under `prisma/migrations/` - so a schema edit that
 * forgot its migration (or a hand-edited migration) fails in CI.
 */
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const repoRoot = resolve(apiRoot, '../..');
const schemaPath = resolve(apiRoot, 'prisma/schema.prisma');
const migrationsDir = resolve(apiRoot, 'prisma/migrations');

/** Migration folders are applied in lexicographic order; concatenate them the same way. */
function readCommittedMigration(): string {
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return folders
    .map((folder) => readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf8'))
    .join('\n');
}

/**
 * Prisma reads the schema and emits the DDL that *should* exist. This is the
 * authoritative drift check: it sees columns, indexes, constraints and enums, not
 * just table names.
 */
function regenerateMigrationFromSchema(): string {
  const prismaCli = resolve(repoRoot, 'node_modules/prisma/build/index.js');
  const stdout = execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema', schemaPath, '--script'],
    {
      cwd: apiRoot,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CHECKPOINT_DISABLE: '1' },
    },
  );

  // The CLI may prepend informational lines before the script; the script itself
  // always starts at the CreateSchema header.
  const start = stdout.search(/^-- CreateSchema$/m);
  return start === -1 ? stdout : stdout.slice(start);
}

/** Compare SQL ignoring trailing whitespace and trailing blank lines only. */
function normalise(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function schemaSource(): string {
  return readFileSync(schemaPath, 'utf8');
}

/** ``@@map("users")`` -> `users`. */
function mappedTables(schema: string): string[] {
  return [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1] as string);
}

/** Pascal-case Prisma model names, in declaration order. */
function enumNames(schema: string): string[] {
  return [...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((match) => match[1] as string);
}

function modelNames(schema: string): string[] {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1] as string);
}

describe('database schema', () => {
  const schema = schemaSource();
  const migration = readCommittedMigration();

  it('keeps the committed migration in sync with schema.prisma', () => {
    const regenerated = regenerateMigrationFromSchema();

    expect(normalise(regenerated)).toBe(normalise(migration));
  });

  it('creates one table per mapped model', () => {
    const tables = mappedTables(schema);
    const createdTables = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      (match) => match[1] as string,
    );

    expect(tables).toHaveLength(modelNames(schema).length);
    expect(new Set(createdTables)).toEqual(new Set(tables));
  });

  it('declares every enum the schema uses', () => {
    const declared = [...migration.matchAll(/CREATE TYPE "([^"]+)" AS ENUM/g)].map(
      (match) => match[1] as string,
    );

    expect(new Set(declared)).toEqual(new Set(enumNames(schema)));
    expect(declared).toHaveLength(20);
  });

  it('gives every table a primary key', () => {
    const createdTables = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      (match) => match[1] as string,
    );

    for (const table of createdTables) {
      expect(migration).toContain(`CONSTRAINT "${table}_pkey" PRIMARY KEY ("id")`);
    }
  });

  it('protects the money and payment paths with unique indexes', () => {
    const requiredIndexes = [
      'users_email_key',
      'auth_identities_provider_provider_user_id_key',
      'credit_wallets_user_id_key',
      'credit_transactions_idempotency_key_key',
      'credit_reservations_idempotency_key_key',
      'feature_pricing_feature_key',
      'payment_transactions_order_id_key',
      'payment_webhook_events_event_key_key',
      'recruiter_preference_versions_user_id_version_key',
      'screening_requirements_job_id_sort_order_key',
      'screening_criterion_results_candidate_id_requirement_id_key',
    ];

    for (const index of requiredIndexes) {
      expect(migration).toContain(`CREATE UNIQUE INDEX "${index}"`);
    }
  });

  it('cascades deletion of user-owned data', () => {
    const cascadingForeignKeys = [
      'auth_identities_user_id_fkey',
      'credit_wallets_user_id_fkey',
      'credit_transactions_user_id_fkey',
      'credit_reservations_user_id_fkey',
      'payment_transactions_user_id_fkey',
      'cv_documents_user_id_fkey',
      'cv_analyses_user_id_fkey',
      'cv_enhancements_user_id_fkey',
      'screening_jobs_user_id_fkey',
      'screening_candidates_job_id_fkey',
      'screening_criterion_results_candidate_id_fkey',
      'evidence_items_candidate_id_fkey',
      'testimonials_user_id_fkey',
    ];

    for (const constraint of cascadingForeignKeys) {
      const definition = migration.match(
        new RegExp(`ADD CONSTRAINT "${constraint}" FOREIGN KEY[^;]+;`),
      )?.[0];

      expect(definition, `${constraint} should exist`).toBeDefined();
      expect(definition).toContain('ON DELETE CASCADE');
    }
  });

  it('keeps CV text optional and private by default', () => {
    expect(migration).toMatch(/"text_content" TEXT/);
    expect(migration).not.toMatch(/"text_content" TEXT NOT NULL/);

    const documents = migration.match(/CREATE TABLE "cv_documents"[\s\S]*?\);/)?.[0] ?? '';
    expect(documents).toContain('"is_ephemeral" BOOLEAN NOT NULL DEFAULT false');
  });
});
