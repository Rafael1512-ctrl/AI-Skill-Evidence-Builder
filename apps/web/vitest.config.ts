import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep the browser tests independent from the developer's root `.env`. Instances that
  // explicitly exercise Supabase opt in through `configureSupabaseEnv()`.
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
