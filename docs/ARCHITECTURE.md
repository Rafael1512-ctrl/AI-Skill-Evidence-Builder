# Architecture

> Started by Phase 15. It describes the system as built; later phases (19, 23) extend it.

## Shape

```
apps/web        React 19 + Vite + TanStack Query. Renders API contracts; computes no score.
apps/api        Express 5 + TypeScript (ESM). The only writer of the database.
packages/shared Zod contracts, enums, credit pricing defaults, error codes, limits.
legacy/         Frozen pre-migration prototype. Reference only - never imported.
```

One account and one credit wallet serve both audiences: job seekers (audit, enhancement,
export) and recruiters (screening). Reviews are evidence-based: the model extracts, the
engine scores.

## Backend layers

```
routes/       HTTP paths -> controllers. No business logic, no Prisma.
controllers/  Parse validated input, call a service, shape the envelope.
services/     Business rules and transactions (credits, screening, scoring, reports).
  providers/  External systems behind interfaces (AI, payments, PDF, outbound HTTP).
  queues/     One ScreeningQueue interface: BullMQ+Redis or in-process.
  workers/    The CandidateProcessor seam and the worker that attaches it.
repositories/ The only modules that touch Prisma.
```

Rules that hold everywhere:

- Validate at the boundary with Zod; validate model output before business logic sees it.
- External systems sit behind an interface so tests never make a network call.
- A prompt is never built inside a provider; composition lives in `prompts/`.

## Screening pipeline

```
POST /screening/jobs                 freeze requirements + preference/scoring/prompt versions
POST /screening/jobs/:id/candidates  ZIP/PDF guards -> text extraction -> QUEUED rows
                                     -> reserve HRD_SCREEN_PER_CV x accepted (one hold)
queue                                BullMQ when REDIS_URL is set, in-process otherwise
CandidateProcessor                   prompts/hrd/evidenceExtractionPrompt.ts -> AIProvider
                                     -> Zod -> utils/evidence.ts grounding -> envelope
services/scoring                     pure engine over the envelope -> criterion rows,
                                     score, eligibility, derived strengths/gaps
run to completion                    settle the hold for delivered CVs, release the rest
GET  /screening/jobs/:id/results     ranked results with evidence
POST /screening/jobs/:id/reports     same payload as CSV or PDF
POST /screening/jobs/:id/candidates/:candidateId/verification
                                     links from the CV -> SSRF-guarded fetch -> summary
```

Guarantees this pipeline is built to keep:

- **No fabrication.** The extraction prompt forbids inventing facts, and an unverifiable
  quote is dropped before storage (a `FOUND` can only be downgraded, never upgraded).
- **No AI ranking.** `services/scoring/engine.ts` is pure: fixed outcome table, weights from
  configuration. The same input always produces the same score, reproducible from the
  stored `earned_score x normalised_weight`.
- **Nothing is lost on failure.** A rejected file, a provider outage or a cancelled batch
  ends with its credits released; a partially successful batch charges only what was
  delivered.
- **Hard requirements never hide anyone.** `REQUIREMENT_NOT_MET` is a label on a candidate
  that stays in the results.

## Outbound fetching

Candidate-supplied URLs are attacker-chosen, so `providers/http/` is the only place that may
resolve one: scheme and hostname rules first, then every resolved address is checked against the
private/loopback/link-local/CGNAT/multicast ranges, then each redirect hop is re-validated (max
three) and the body is read under a timeout and a byte cap, with a content-type allowlist.
LinkedIn is never fetched at all - it is recorded as a self-reported claim. Fetched pages are
summarised through the prompt boundary (`HRD_PORTFOLIO_VERIFICATION_V1`) and cached in
`IntegrationEvidenceSnapshot` for a day. `OUTBOUND_HTTP_PROVIDER=mock` keeps development and the
test suite offline, and the guards run in both modes.

## Credit flow

`estimate -> reserve -> execute -> settle (or release)`, always through `CreditService` and
always inside a database transaction that writes a ledger row. Prices are resolved from
`packages/shared` defaults plus the `FeaturePricing` table; no component, controller or
service hardcodes a credit amount. Reports are included in the per-CV screening price and
have no feature key of their own.

## Prompt orchestration

Five layers, in order: global policy, feature system prompt, structured user/recruiter
context, current task parameters, then untrusted documents - always delimited, always last.
Each prompt carries a version id (`JOB_SEEKER_AUDIT_V1`, `JOB_SEEKER_ENHANCE_V1`,
`HRD_SCREENING_V1`, `HRD_EVIDENCE_EXTRACTION_V1`, `HRD_PORTFOLIO_VERIFICATION_V1`) that is
persisted with the result so historical output stays auditable. Details:
`docs/AI_PROMPTS.md`.

## Frontend

`lib/api.ts` is the single HTTP entry point: every response is parsed through the shared Zod
contract, so a server change surfaces as a typed error rather than a broken screen.
TanStack Query owns server state (polling a running batch, invalidating after a mutation);
the pages render the stored results and never recompute a derived number.

Routes: `/` landing, `/audit` (public), `/enhance`, `/profile`, `/credits`, `/screening`,
`/screening/:jobId` (session required), `/signin`.

## Containers (Phase 21)

```
web   nginx: static Vite build + /api proxy (same-origin, so no CORS growth)
api   node: dist/server.js, non-root, healthcheck on /api/health
worker same image, command: node dist/worker.js
migrate same image's build target, runs `prisma migrate deploy` once and exits
db    postgres:16-alpine  (volume: postgres-data)
redis redis:7-alpine      (volume: redis-data)
```

- One image for the API and the worker: they differ only in their command, which guarantees the
  compiled code, the generated Prisma client and the migration files can never drift apart.
- The Prisma client is **generated inside the image** (`npm run gen`) with `prisma generate`
  deliberately ordered after `build:shared` and before `tsc`; the runtime stage copies the result,
  so no compiler or CLI is needed to start serving.
- `migrate` gates the API and the worker with `service_completed_successfully`, so a container can
  never serve against an un-migrated database.
- Defaults are the offline providers, so `docker compose up` needs no credentials; secrets arrive
  as `DOCKER_*` environment variables (git-ignored `.env.docker`), never from the repository.
- The browser talks to nginx and nginx proxies `/api`, which keeps `CORS_EXTRA_ORIGINS` empty for
  the containerised stack.
- The image has no real PDF renderer: Chromium is skipped to keep it small, and `PDF_RENDERER=mock`
  returns a deterministic file. Real rendering needs a derived image (documented in the README).

## Testing

- Unit and integration tests live next to the code; Vitest runs them per workspace.
- Integration tests that need Postgres boot an in-process PGlite instance and apply the
  **real** migration SQL, so ledger, reservation, scoring and webhook-idempotency behaviour
  is exercised against genuine PostgreSQL semantics - no Docker.
- AI, payments, GitHub, outbound HTTP, Chromium and the queue are replaced by deterministic
  doubles (`AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, `OUTBOUND_HTTP_PROVIDER=mock`,
  `PDF_RENDERER=mock`, in-process queue); the default suite makes no network call.
- Playwright specs live in `apps/web/e2e` and are not part of the default suite.

## Continuous integration (Phase 22)

`.gitlab-ci.yml` mirrors those gates on a `node:22-bookworm` runner:

```
quality  lint, typecheck
test     vitest (unit + PGlite integration), production builds
e2e      Playwright against the real API + a throwaway Postgres + mock providers
images   docker build (push only from a tag)
```

- **PGlite needs no service**, only permission to bind a local socket, which a normal runner has.
  That is the whole reason a restricted sandbox cannot run these suites (§8.4) while CI can.
- The E2E job is the only one with a service: the API actually starts, so it needs a real
  Postgres, and `prisma migrate deploy` runs before it. Playwright's `webServer` starts both
  servers, so the job has no hidden prerequisite.
- Images are built on every pipeline and published only from a git tag; **no job deploys**.

## Known gaps

- No storage provider yet: exported CVs and screening reports return their bytes inline, and
  only metadata plus a content hash is stored.
- Rate limiting is in-memory (per instance); Redis-backed limiting is needed before
  horizontal scaling.
- Docker (21) and GitLab CI (22) do not exist yet; `docs/SECURITY.md` (19) is still owed.
- Verification statuses report what the system could corroborate (`SUPPORTED` / `UNVERIFIED` /
  `NOT_CHECKED`); cross-checking a specific CV claim against a page (`CONFLICTING_INFORMATION`) is
  not implemented yet.
