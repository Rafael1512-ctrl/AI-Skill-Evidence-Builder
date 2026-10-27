import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

/**
 * Loads `.env` files before any module reads `process.env`.
 *
 * Precedence (first file wins for a given key):
 *   1. apps/api/.env   - workspace-local overrides
 *   2. <repo>/.env     - the shared file created from .env.example
 *
 * Existing environment variables are never overwritten, so CI and containers keep
 * full control. Importing this module has the side effect of loading the files;
 * `env.ts` imports it first.
 */
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [resolve(here, '../../.env'), resolve(here, '../../../../.env')];

/**
 * Tests never read `.env`: the suite must not accidentally connect to a real
 * database or call a real AI provider. The test harness injects its own values.
 */
const isTest = process.env.NODE_ENV === 'test';

if (!isTest) {
  const paths = candidates.filter((candidate) => existsSync(candidate));
  if (paths.length > 0) {
    loadDotenv({ path: paths, quiet: true, override: false });
  }
}
