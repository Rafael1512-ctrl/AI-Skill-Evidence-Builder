# AI Skill Evidence Builder

One AI platform serving two audiences with a **single account** and a **single credit wallet**:

- **Job Seekers** - audit a CV for free, then enhance it with AI that never invents facts.
- **HRD / Recruiters** - screen up to 50 CVs per batch with evidence shown for every criterion.

The product philosophy is **EVIDENCE BEFORE ASSUMPTION**: the AI extracts structured evidence from a
CV, and a deterministic Node.js scoring engine - not the model - decides the final score and ranking.
Recruiters always see _why_ a candidate scored the way they did, and candidates with an unmet hard
requirement stay visible instead of silently disappearing.

---

## Features

**Job Seeker**

- Free CV audit for guests: PDF upload, no account, 0 credits, structured ATS-oriented feedback.
- Paid CV enhancement (5 credits) with an explicit anti-fabrication contract, target role tailoring,
  optional GitHub / LinkedIn / portfolio links, and a Before vs After preview.
- Three export templates: ATS Minimal, Professional, Modern.

**HRD / Recruiter**

- Screening jobs with REQUIRED / PREFERRED / BONUS criteria, weights, and hard requirements.
- Batch upload of up to 50 PDFs, or a ZIP, with archive hardening.
- Per-criterion evidence (`FOUND` / `NOT_FOUND` / `UNCERTAIN`) with quotes and source pages.
- Deterministic, reproducible scoring stored with the exact configuration version used.
- Live progress, partial-success batches, CSV and PDF reports.

**Shared**

- One wallet, one ledger, no subscriptions. Top-up from Rp50.000 (50 credits).
- Working top-up flow: checkout, a signature-verified idempotent webhook, and credits granted
  only through the ledger. The offline `mock` provider settles end-to-end in development;
  the Midtrans adapter is prepared but never auto-activated.
- Testimonials with moderation.
- Admin console: users, wallets, transactions, payments, AI usage, jobs, failed jobs, testimonials,
  feature pricing, system health.

---

## Tech stack

| Layer    | Technology                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| Frontend | React 19, Vite 8, TypeScript, React Router 7, TanStack Query 5, Tailwind CSS 4 |
| Backend  | Node 20+, Express 5, TypeScript (ESM), Zod 4, Pino                             |
| Database | PostgreSQL (Supabase) via Prisma 7                                             |
| Auth     | Supabase Auth (email/password + Google OAuth), server-side JWKS verification   |
| Queue    | BullMQ + Redis (in-process driver when `REDIS_URL` is unset)                   |
| AI       | DeepSeek via the OpenAI-compatible SDK, behind a swappable provider interface  |
| PDF      | `pdf-parse` in, Puppeteer + HTML/CSS templates out                             |
| Tests    | Vitest, Supertest, React Testing Library, Playwright                           |

---

## Quick start

Requires **Node 20+** and **npm 10+**. Works on macOS and Windows.

```bash
git clone <your-remote> ai-skill-evidence-builder
cd ai-skill-evidence-builder
npm install
cp .env.example .env       # then fill in values; never commit this file
npm run build:shared       # build workspace contracts once
npm run dev                # API on :4000, web on :5173
```

You can start immediately with the offline defaults already in `.env.example`:

- `AI_PROVIDER=mock` - no AI key required.
- `PDF_RENDERER=mock` - CV exports return a deterministic offline PDF instead of launching
  Chromium; set `PDF_RENDERER=puppeteer` for real rendering.
- `PAYMENT_PROVIDER=mock` - no payment credentials required.
- `AUTH_DEV_MODE=true` - local HS256 tokens for development and tests; the browser uses them
  automatically while `VITE_SUPABASE_*` is empty.

To use real services, set `DATABASE_URL`, `SUPABASE_*`, `DEEPSEEK_*` and `REDIS_URL`.

### Enabling real Supabase auth (email/password + Google)

Everything lives in the root `.env`: the API reads it through dotenv and Vite is pointed at the
repository root, so the `VITE_` mirrors there reach the browser. Only `VITE_`-prefixed keys are
inlined into the bundle; the server-side secrets in the same file stay server-side.

1. Create the Supabase project, then copy the Project URL, the publishable/anon key and the
   `service_role` key into `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, and
   the first two again into `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
2. Point `DATABASE_URL` at the pooled connection (port 6543) and `DIRECT_URL` at the direct one
   (port 5432), then run `npm run db:deploy`.
3. In Google Cloud Console create a **Web application** OAuth client with the authorised redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`, and paste its client id/secret into
   Supabase → Authentication → Providers → Google. They never belong in this repository.
4. In Supabase → Authentication → URL Configuration set the site URL (`http://localhost:5173` in
   development) and add `<origin>/profile` to the redirect allow list. The app returns to `/profile`
   after Google sign-in, after email confirmation and after Google identity linking.
5. Keep an asymmetric JWT signing key active: the API verifies access tokens through
   `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
6. Set `AUTH_DEV_MODE=false` and restart the API. The sign-in page then offers "Lanjutkan dengan
   Google" and Supabase email/password sign-in and sign-up, and the local dev endpoints stop being
   used by the browser.

Leaving `VITE_SUPABASE_*` empty keeps the offline `AUTH_DEV_MODE` strategy, so local development and
the automated test suite are unaffected.

### Windows notes

All scripts are npm scripts, so PowerShell and Git Bash both work. Copy files with
`Copy-Item .env.example .env` in PowerShell. Do not rely on `export`; use a `.env` file.

---

## Running with Docker

```bash
docker compose up --build          # web on http://localhost:8080, API on :4000
docker compose run --rm migrate    # only needed if you changed the schema
docker compose down -v             # stop and wipe the local database/redis volumes
```

The stack is self-contained and deliberately offline: Postgres and Redis containers, the API, a
separate queue worker (same image, different entry point) and nginx serving the built web app and
proxying `/api` so the browser stays same-origin. Defaults are `AI_PROVIDER=mock`,
`PAYMENT_PROVIDER=mock`, `PDF_RENDERER=mock`, `OUTBOUND_HTTP_PROVIDER=mock` and
`AUTH_DEV_MODE=true`, so it starts without any provider credentials. Migrations run in a one-shot
`migrate` service that the API and worker wait for (`service_completed_successfully`).

Nothing sensitive is read from the repository's `.env`. Compose only looks at `DOCKER_*`
variables, so you can keep local development (`npm run dev`) and the container stack configured
independently. Put overrides in a git-ignored `.env.docker` and pass it explicitly:

```bash
# .env.docker - never committed (.gitignore covers .env.*)
DOCKER_AI_PROVIDER=deepseek
DOCKER_DEEPSEEK_API_KEY=sk-...
DOCKER_PAYMENT_PROVIDER=midtrans
DOCKER_MIDTRANS_SERVER_KEY=<server key from the Midtrans dashboard>
DOCKER_MIDTRANS_CLIENT_KEY=<client key from the Midtrans dashboard>
DOCKER_MIDTRANS_MERCHANT_ID=<merchant id>

docker compose --env-file .env.docker up --build
```

Useful variables (all defaulted): `DOCKER_WEB_PORT` (8080), `DOCKER_API_PORT` (4000),
`DOCKER_DB_PORT` (5432), `DOCKER_POSTGRES_USER/PASSWORD/DB`, `DOCKER_AUTH_DEV_MODE`,
`DOCKER_ADMIN_EMAILS`, `DOCKER_LOG_LEVEL`, `DOCKER_PDF_RENDERER`, `DOCKER_OUTBOUND_HTTP_PROVIDER`.

The API image deliberately skips the Chromium download (`PUPPETEER_SKIP_DOWNLOAD=true`) and ships
with `PDF_RENDERER=mock`; exports then return a deterministic offline PDF. To render real PDFs,
either install Chromium in your own derived image and set `DOCKER_PDF_RENDERER=puppeteer` plus
`PUPPETEER_EXECUTABLE_PATH`, or run the API outside the container.

---

## Commands

```bash
npm run dev            # API + web together
npm run dev:api        # API only
npm run dev:web        # web only
npm run dev:worker     # screening queue worker

npm run lint           # ESLint (flat config)
npm run typecheck      # tsc --noEmit in every workspace
npm run test           # Vitest unit + integration
npm run test:coverage  # Vitest with V8 coverage
npm run test:e2e       # Playwright (needs: npx playwright install chromium)
npm run build          # production builds

npm run db:generate    # prisma generate
npm run db:migrate     # prisma migrate dev (needs DATABASE_URL)
npm run db:deploy      # prisma migrate deploy
npm run db:studio      # prisma studio

npm run format         # prettier --write .
```

---

## Repository layout

```
apps/api          Express + TypeScript API, Prisma schema, queue workers, tests
apps/web          React + Vite frontend, Playwright specs
packages/shared   Zod contracts, enums, credit pricing defaults, error codes
docs              ARCHITECTURE, DATABASE, API, AI_PROMPTS, SECURITY
legacy            Frozen pre-migration prototype (reference only)
```

Read `PROJECT_CONTEXT.md` for the live handover notes and `AGENTS.md` before contributing code.

Going online: `docs/DEPLOYMENT.md` is the deploy runbook (container stack or managed pieces, the
environment per environment, the post-deploy smoke test and the known launch limits).

---

## Testing without external services

The default test suite never makes a real network call.

- Database tests boot an in-process PGlite instance and apply the **real** Prisma migration SQL, so
  ledger atomicity, reservation, scoring and webhook idempotency behaviour is exercised against
  genuine PostgreSQL semantics - no Docker required.
- AI, payments, GitHub and outbound HTTP are replaced by deterministic mocks.
- The screening queue runs in-process when `REDIS_URL` is unset, so no Redis is needed either
  (the worker handler itself is exercised with a stubbed candidate processor).
- The integration tests boot PGlite in-process and need permission to bind a local socket, which a
  normal shell and a CI runner have (a restricted sandbox does not). PGlite is the only supported
  test database today.

---

## Continuous integration

`.gitlab-ci.yml` runs the same gates a contributor runs, plus the image build:

| Stage   | Job                 | What it does                                                                 |
| ------- | ------------------- | ---------------------------------------------------------------------------- |
| quality | `lint`, `typecheck` | ESLint and `tsc --noEmit` in every workspace                                 |
| test    | `test`, `build`     | Vitest (unit + PGlite integration) and the production builds                 |
| e2e     | `e2e`               | Playwright against the real API, a throwaway Postgres and the mock providers |
| images  | `images`            | `docker build` for the API and web images; pushes only from a git tag        |

`npm ci` runs with scripts enabled because `@prisma/engines` needs its postinstall, while Chromium
and husky are disabled explicitly (`PUPPETEER_SKIP_DOWNLOAD`, `HUSKY=0`). The cache is keyed on
`package-lock.json`. Provider calls stay offline in every job. Nothing in the pipeline deploys:
activating a real deployment remains a human decision.

Playwright's `webServer` starts the API and the web dev server, so the E2E job needs no external
services beyond Postgres; locally it starts its own servers too and deliberately refuses to reuse a
running `npm run dev` (`reuseExistingServer: false`), so it never asserts a differently configured
instance.

### Running the browser suite locally

```bash
npx playwright install chromium          # once

docker compose up -d db                  # the disposable database the suite uses by default
DATABASE_URL='postgresql://aseb:aseb@localhost:5432/aseb?schema=public' \
  DIRECT_URL='postgresql://aseb:aseb@localhost:5432/aseb?schema=public' npm run db:deploy
npm run test:e2e                         # Playwright starts the API and the web app itself
```

Playwright starts both servers itself and waits for their ports, pins the API under test to the
offline providers (`AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, `PDF_RENDERER=mock`,
`OUTBOUND_HTTP_PROVIDER=mock`) and to `AUTH_DEV_MODE=true`, and starts the web app with
`vite --mode e2e` so the browser uses the same offline auth strategy (`.env.e2e`, committed, pins
the `VITE_SUPABASE_*` mirrors to empty - otherwise a configured Supabase project would take over
the browser while the API only accepts dev tokens). Servers you already have running are
deliberately **not** reused, so the suite can never test a differently configured instance: stop
`npm run dev` first, and a busy port fails immediately instead of hanging. Readiness is port-based
on purpose: probing `/api/health` would make the wait depend on the database being reachable, and a
timeout there is misleading. Both servers are pinned to `127.0.0.1`, and the suite's `baseURL` uses
the same host: `localhost` resolves to `::1` first on macOS, so a browser sent to `127.0.0.1` while
the dev server listens on `::1` fails with `ERR_CONNECTION_REFUSED` even though the port probe -
which checks both families - reports the server as ready.

**Which database it writes to**, in order: `E2E_DATABASE_URL` (and `E2E_DIRECT_URL` for migrations),
then `DATABASE_URL`/`DIRECT_URL` exported in the environment, then the disposable `docker compose`
Postgres at `postgresql://aseb:aseb@localhost:5432/aseb`. The repository `.env` is **never** read by
this suite. It used to be, and that silently pointed `npm run test:e2e` at whatever project `.env`
held - so its accounts (`e2e-...@example.com`), screening batches and credit rows landed in the
developer's Supabase project instead of a throwaway database.

Two guards keep that from coming back: a run refuses to start against a host that is not loopback
(or the Compose/CI service name) unless `E2E_ALLOW_REMOTE_DATABASE=1` is set explicitly, and every
run prints the host it is about to write to. The specs create real rows, so never point them at the
project you keep clean.

Without Docker, a local Postgres from Homebrew works too - export the URL so the suite picks it up:

```bash
brew install postgresql@16 && brew services start postgresql@16 && createdb aseb
export DATABASE_URL='postgresql://localhost:5432/aseb?schema=public'
export DIRECT_URL="$DATABASE_URL"
npm run db:deploy
npm run test:e2e
```

On PowerShell, set the migration variables through a `.env` file or `$env:DATABASE_URL` instead of
the inline `VAR=value` prefix.

If the run still reports `Timed out waiting ... from config.webServer`, check in this order: is
the database reachable (`docker compose up -d db`, and migrations applied with `npm run db:deploy`),
does `npm run dev:api` start by hand, and is only one process listening on 4000/5173.

---

## Security and privacy

- CVs are sensitive personal data. Anonymous audit uploads are processed in memory and are not
  permanently retained by default.
- CV text and fetched web pages are treated as untrusted data, never as instructions.
- Portfolio verification is SSRF-guarded: no localhost, no private ranges, no metadata endpoints,
  no redirect surprises, hard timeouts and response-size caps.
- Payment webhooks require signature + amount + transaction verification and are idempotent.
- Admin access is enforced by server-side middleware, never by hiding a route.

See `docs/SECURITY.md` for the full threat model.

---

## License

Proprietary - all rights reserved. Not licensed for redistribution.
