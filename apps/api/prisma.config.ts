import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * Connection URLs live here rather than in `schema.prisma`:
 *  - the runtime client uses DATABASE_URL directly through `@prisma/adapter-pg`;
 *  - migration and introspection commands prefer DIRECT_URL (the unpooled
 *    Supabase connection) and fall back to DATABASE_URL.
 */
const here = dirname(fileURLToPath(import.meta.url));

loadDotenv({
  path: [resolve(here, '../../.env'), resolve(here, '.env')],
  quiet: true,
});

function migrationUrl(): string | undefined {
  const direct = process.env.DIRECT_URL?.trim();
  const pooled = process.env.DATABASE_URL?.trim();
  return direct && direct.length > 0 ? direct : pooled;
}

export default defineConfig({
  schema: resolve(here, 'prisma/schema.prisma'),
  migrations: {
    path: resolve(here, 'prisma/migrations'),
  },
  datasource: {
    url: migrationUrl(),
  },
});
