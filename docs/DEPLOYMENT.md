# Deployment

> Written in Phase 23. **Nothing has been deployed yet** - not to production, not even to a
> Supabase project. This is the runbook for the owner's first online run, and it is explicit about
> which parts have been verified where.

## 0. What "ready" means here

The application is ready to be deployed; the deployment itself is deliberately not automated:

- No CI job deploys. `images` builds containers and pushes them **only from a git tag**.
- Production refuses to start with development settings: `AUTH_DEV_MODE=true` outside development,
  a missing `DEEPSEEK_API_KEY` when `AI_PROVIDER=deepseek`, or `PAYMENT_PROVIDER=midtrans` without a
  server key all fail validation at boot (`apps/api/src/config/env.ts`).
- The security checklist with the reasoning is `docs/SECURITY.md` section 5.

## 1. Prerequisites

| Thing                       | Why                                                                       |
| --------------------------- | ------------------------------------------------------------------------- |
| Postgres (Supabase is fine) | The database, with the migrations applied                                 |
| Redis                       | Shared rate limits and the out-of-process queue (`REDIS_URL`)             |
| A host for the API + worker | Any container host; both run from the same image                          |
| A host for the web build    | Static hosting, or the nginx image from `apps/web/Dockerfile`             |
| DeepSeek API key            | `AI_PROVIDER=deepseek` (`mock` keeps everything offline)                  |
| Midtrans keys (sandbox)     | Only when you are ready to accept real top-ups                            |
| Supabase project            | Real auth (email/password + Google); optional while `AUTH_DEV_MODE` is on |

## 2. Database

1. Create the Supabase project (or any Postgres) and copy the connection strings.
2. `DATABASE_URL` (runtime) is the **transaction pooler** (port 6543) with `?sslmode=no-verify`;
   `DIRECT_URL` (migrations) is the **session pooler** (port 5432) with `?sslmode=verify-full`.
   Mixing these up produces `P1001`/`P1011` - the symptom map is in `PROJECT_CONTEXT.md` section 6.
3. Apply the schema: `npm run db:deploy` locally against the project, or
   `docker compose run --rm migrate` in the container stack. From here on migrations are additive:
   never edit an applied one.
4. Verify: `GET /api/health` must report `database: connected`.

## 3. Option A - one host, the container stack (recommended for the MVP)

```bash
git clone <remote> && cd ai-skill-evidence-builder
cp .env.example .env.docker        # then edit it, see section 5
docker compose --env-file .env.docker up -d --build
docker compose logs -f api         # migrate runs first, then the API starts
```

Put a TLS terminator in front (Caddy, nginx, Traefik or the platform's load balancer) and point it
at the `web` container. `web` proxies `/api` to the API, so the browser stays same-origin and
`CORS_EXTRA_ORIGINS` can stay empty.

Non-negotiables for this option:

- `DOCKER_AUTH_DEV_MODE=false` with real Supabase variables - otherwise anyone can create accounts
  through the development endpoints.
- `DOCKER_ADMIN_EMAILS` set to your own address so the first admin exists (the server enforces the
  role; the UI only hides the link).
- `DOCKER_NODE_ENV=production`, `DOCKER_LOG_LEVEL=info`; compose already sets `REDIS_URL`.
- `DOCKER_PDF_RENDERER=mock` unless you build a derived image with Chromium (see the README): the
  default image deliberately ships without it.

## 4. Option B - managed pieces

1. **Web**: build with `VITE_API_BASE_URL=https://api.example.com` (or leave it empty and proxy
   `/api`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, then deploy `apps/web/dist` to any static
   host. Only `VITE_`-prefixed values reach the browser - never put a server key in that build.
2. **API + worker**: run the API image (or `node apps/api/dist/server.js`) and the worker
   (`node apps/api/dist/worker.js`) as separate processes. Set `REDIS_URL` so rate limits are shared
   and the queue runs out of process.
3. **Database**: as in section 2. Run migrations from CI or locally, never from the API container on
   boot.
4. **CORS**: add the real web origin to `CORS_EXTRA_ORIGINS` (comma-separated). The allowlist
   rejects everything else.
5. **Supabase auth**: keep an asymmetric signing key active, add `<web-origin>/profile` to the
   redirect allow list and set `AUTH_DEV_MODE=false`. The exact steps, and the gap between
   "unit-tested" and "run against a live project", are in `PROJECT_CONTEXT.md` section 8.14.

## 5. Environment per environment

`.env.example` documents every key. The ones that decide whether a deployment is safe:

| Variable                          | Development        | Production                                       |
| --------------------------------- | ------------------ | ------------------------------------------------ |
| `NODE_ENV`                        | `development`      | `production` (validation becomes strict)         |
| `AUTH_DEV_MODE`                   | `true`             | **`false`** (the API refuses `true` here)        |
| `DATABASE_URL` / `DIRECT_URL`     | local or Supabase  | pooler with `no-verify` / session pooler         |
| `REDIS_URL`                       | unset (in-process) | set (shared limits + out-of-process worker)      |
| `AI_PROVIDER`                     | `mock`             | `deepseek` + `DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL` |
| `PAYMENT_PROVIDER`                | `mock`             | `midtrans` + `MIDTRANS_SERVER_KEY`               |
| `OUTBOUND_HTTP_PROVIDER`          | `mock`             | `guarded` to enable link verification            |
| `PDF_RENDERER`                    | `mock`             | `puppeteer` (needs Chromium in the image)        |
| `ADMIN_EMAILS`                    | your address       | your address (first admin bootstrap)             |
| `CORS_EXTRA_ORIGINS`              | empty              | the real web origin(s) only                      |
| `GUEST_AUDIT_RATE_LIMIT`, `MAX_*` | defaults           | review against expected traffic                  |

Secrets come from the platform's secret store. `.env` and `.env.*` are git-ignored, `.env.example`
holds placeholders only, and `docs/SECURITY.md` section 2 lists what must never be logged.

In the container stack every value is passed as a `DOCKER_*` variable (see the README), so the
developer `.env` never reaches a build.

## 6. Smoke test after the first deploy

1. `GET /api/health` -> `status: ok`, `database: connected`, and the providers you configured.
2. Guest flow: `/audit`, upload a text PDF, get a structured result (0 credits, no account).
3. Account flow: sign in, `/profile` loads, Google linking works if it is configured.
4. Top-up: one **sandbox** payment, credits appear exactly once in the ledger, then replay the same
   notification and confirm it is a duplicate no-op (`/api/admin/webhook-events`).
5. Screening: create a job, upload one CV, wait for `COMPLETED`, open the results, export a CSV.
6. Admin: `GET /api/admin/overview` shows the users and ledger totals you expect.

## 7. Known limits at launch

Read `PROJECT_CONTEXT.md` section 8 before promising anything to a user. The ones that matter for a
live deployment:

- No live DeepSeek, Supabase or Midtrans run has ever happened (sections 8.12, 8.14, 8.26).
- The Docker stack and the CI pipeline have never executed, and Playwright has never launched a
  browser (sections 8.45, 8.46, 8.48).
- Link verification is stored and displayed but does not influence the score (8.35).
- Exported PDFs and reports are streamed, not stored: the row keeps the size and SHA-256
  (8.31).
- Rate limiting is only shared across replicas once `REDIS_URL` is set everywhere (8.2).
- Admin is a single all-or-nothing role (8.42).

## 8. Rollback

- **Code**: redeploy the previous image tag (tags carry the git tag and the commit sha).
  Migrations are additive, so an older image keeps working against a newer schema.
- **Migrations**: never edit or drop an applied migration; add a new one that reverses the change.
- **Data**: the credit ledger is append-only. A wrong adjustment is corrected with another
  `ADJUSTMENT` entry (the admin API does exactly that), never by editing rows.
