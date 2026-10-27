import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each test file gets its own in-process database; run files sequentially to
    // keep PGlite memory bounded and results deterministic.
    fileParallelism: false,
    // Tests never read the developer's .env file (see src/config/load-env.ts).
    env: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      PAYMENT_PROVIDER: 'mock',
      OUTBOUND_HTTP_PROVIDER: 'mock',
      LOG_LEVEL: 'silent',
    },
  },
});
