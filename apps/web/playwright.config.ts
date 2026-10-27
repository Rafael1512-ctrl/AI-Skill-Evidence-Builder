import { defineConfig, devices } from '@playwright/test';

/**
 * Database the browser suite uses - decided here, and nowhere else.
 *
 * Resolution order:
 *   1. `E2E_DATABASE_URL`, with `E2E_DIRECT_URL` when migrations must go somewhere else.
 *   2. `DATABASE_URL` / `DIRECT_URL` from the **process environment**: what CI does with its
 *      Postgres service, or what a developer gets by exporting one on the command line.
 *   3. The disposable `docker compose` Postgres (`docker compose up -d db`).
 *
 * The repository `.env` is deliberately never read. Loading it is how this suite used to write its
 * throwaway accounts (`e2e-...@example.com`), screening batches and credit rows into the
 * developer's Supabase project whenever `DATABASE_URL` was not exported, and it also leaked
 * `VITE_SUPABASE_*` into the browser build (PROJECT_CONTEXT 8.55 and 8.60).
 */
const DISPOSABLE_E2E_DATABASE_URL = 'postgresql://aseb:aseb@localhost:5432/aseb?schema=public';

/**
 * Hosts the suite may write to without an explicit opt-in: loopback, the Compose service name and
 * the CI service alias. Anything else is refused - the specs create real rows, so pointing them at
 * a shared or production database must never happen by accident.
 */
const SAFE_E2E_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? DISPOSABLE_E2E_DATABASE_URL;
// An explicit E2E_DIRECT_URL wins for migrations, then an exported DIRECT_URL, then the suite URL.
const e2eDirectUrl = process.env.E2E_DIRECT_URL ?? process.env.DIRECT_URL ?? e2eDatabaseUrl;

function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const e2eDatabaseHost = databaseHost(e2eDatabaseUrl);
const remoteDatabaseAllowed = process.env.E2E_ALLOW_REMOTE_DATABASE === '1';

if (
  !remoteDatabaseAllowed &&
  e2eDatabaseHost.length > 0 &&
  !SAFE_E2E_DATABASE_HOSTS.has(e2eDatabaseHost)
) {
  throw new Error(
    [
      `Refusing to run the browser suite against "${e2eDatabaseHost}": it is not a local database.`,
      '',
      'The specs create real accounts, screening batches, credit rows and reports. Run them against',
      'the disposable database instead:',
      '',
      '  docker compose up -d db',
      "  DATABASE_URL='postgresql://aseb:aseb@localhost:5432/aseb?schema=public' \\",
      "    DIRECT_URL='postgresql://aseb:aseb@localhost:5432/aseb?schema=public' npm run db:deploy",
      '  npm run test:e2e',
      '',
      `If "${e2eDatabaseHost}" really is disposable, opt in with E2E_ALLOW_REMOTE_DATABASE=1.`,
    ].join('\n'),
  );
}

// Playwright evaluates this config in every worker, so only the main process announces the target.
/* eslint-disable no-console -- a browser run must never hide which database it writes to */
if (process.env.TEST_WORKER_INDEX === undefined) {
  console.log(
    `[e2e] database: ${e2eDatabaseHost || 'unparseable'} (${
      SAFE_E2E_DATABASE_HOSTS.has(e2eDatabaseHost) ? 'local' : 'remote'
    })`,
  );
}
/* eslint-enable no-console */

/**
 * End-to-end configuration.
 *
 * Run `npx playwright install chromium` once, then `npm run test:e2e`. The suite starts both
 * servers itself (see `webServer` below), so it works the same locally and in CI; the API runs
 * with the offline providers (`AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, `PDF_RENDERER=mock`,
 * `OUTBOUND_HTTP_PROVIDER=mock`) and the dev auth strategy, and it needs a reachable
 * database with the migrations applied - CI provides a throwaway Postgres service and locally
 * `docker compose up -d db` does.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Pinned to the IPv4 loopback the web server binds to below. `localhost` is not good enough:
    // it resolves to `::1` first on macOS, so a browser pointed at `127.0.0.1` gets
    // `ERR_CONNECTION_REFUSED` while the port probe still reports the server as ready.
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  /*
   * Both servers are started here instead of being assumed, which is what makes the suite
   * self-contained. Existing servers are deliberately **not** reused (`reuseExistingServer: false`):
   * a developer's `npm run dev` runs with their own `.env` (real providers, Supabase auth) while
   * this suite asserts the offline, deterministic configuration, and silently testing the wrong
   * configuration is worse than a few seconds of startup. Stop `npm run dev` before running the
   * suite; a busy port now fails immediately instead of hanging.
   *
   * Readiness is checked by TCP port, not by URL, for two reasons found on the first real run:
   * the servers advertise `localhost` (which macOS resolves to IPv6 first, while the probe used
   * 127.0.0.1), and `/api/health` performs a database round-trip, so a paused or unreachable
   * Supabase project made the probe hang instead of failing loudly. The specs themselves still
   * need a migrated database - they sign users up - but that failure now surfaces as a test
   * error, not as a 120-second timeout.
   *
   * The API under test is pinned to the offline doubles and the development auth strategy, so a
   * browser run never calls DeepSeek, Midtrans or the open web, and never depends on the
   * developer's provider configuration.
   */
  webServer: [
    {
      command: 'npm run dev:api',
      cwd: '../..',
      port: 4000,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        AUTH_DEV_MODE: 'true',
        // Minting a development token requires this secret, and CI has no `.env`. Pin a
        // non-secret value the same way AUTH_DEV_MODE is pinned; an explicit environment
        // value still wins, so a developer can override it.
        AUTH_DEV_JWT_SECRET: process.env.AUTH_DEV_JWT_SECRET ?? 'e2e-dev-jwt-secret',
        AI_PROVIDER: 'mock',
        PAYMENT_PROVIDER: 'mock',
        PDF_RENDERER: 'mock',
        OUTBOUND_HTTP_PROVIDER: 'mock',
        DATABASE_URL: e2eDatabaseUrl,
        DIRECT_URL: e2eDirectUrl,
      },
    },
    {
      // `--mode e2e` loads `.env.e2e` (committed), which pins the browser to the same offline
      // auth strategy the API is pinned to; without it a developer's `VITE_SUPABASE_*` would send
      // the browser through the real Supabase SDK while the API only accepts dev tokens.
      // `--strictPort` makes a busy 5173 fail immediately instead of moving to 5174 and leaving
      // the readiness probe waiting on the wrong port.
      command: 'npx vite --mode e2e --host 127.0.0.1 --port 5173 --strictPort',
      port: 5173,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // `.env.e2e` already pins these to empty, but Vite gives the process environment priority
        // over `.env.<mode>`, so an exported `VITE_SUPABASE_*` (a developer's shell, or a CI
        // variable) would still send the browser through the real Supabase SDK while the API under
        // test only accepts development tokens - the leaking variant of PROJECT_CONTEXT 8.55.
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_ANON_KEY: '',
        VITE_API_BASE_URL: '',
        // The dev server proxies to the API inside the same process; keep that hop on IPv4 too.
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:4000',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
