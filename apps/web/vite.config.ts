import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /**
   * One `.env` at the repository root feeds every workspace: the API loads it through
   * dotenv and Vite is pointed at it here. Without this, Vite looks in `apps/web` and
   * silently ignores the root `VITE_SUPABASE_*` values, so the browser SDK never gets
   * its Supabase configuration.
   *
   * Safe by construction: only `VITE_`-prefixed keys are exposed to the bundle, so the
   * server-side secrets that share this file (database URL, service-role key, provider
   * keys) can never reach the client.
   */
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Keeps local development same-origin so CORS never enters the picture.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
