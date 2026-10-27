# PROJECT_CONTEXT.md

> Read this file first, together with `AGENTS.md` and `README.md`, before making changes.
> It is the handover document for coding agents and maintainers.

Last updated: 2026-09-26 — end of the agent-doable slice of **Phase 23 (Final Documentation &
Verification)**; the owner-run verification (full suite, browser suite, container stack, live
providers) is the remainder.
Addendum 2026-09-26: cross-cutting **Runtime AI Context / Prompt Orchestration** requirement
recorded in §11 and specified in `docs/AI_PROMPTS.md`. The audit slice is implemented in Phase 6 and
the enhancement slice in Phase 7, the recruiter context in Phase 10 and the screening extraction in
Phase 13; only the portfolio-verification slice (Phase 16) remains.
Addendum 2026-09-26 (b): the browser suite no longer resolves its database from `.env` - it uses
`E2E_*` or environment URLs, otherwise the disposable Compose Postgres, and refuses non-local hosts
(§8.60); its servers are pinned to IPv4 loopback so the browser, the port probe and the Vite proxy
cannot disagree about `localhost` (§8.61); and every rate limiter now has its own counter namespace,
which was the second CI e2e failure (§8.62).
Addendum 2026-09-27: the HRD screening results screen gained credit-cost disclosure, confirmation
dialogs (balance before/after) and a bulk **Verifikasi semua** action with its own preflight and
all-or-nothing credit validation (§8.63).

**Workflow rule in force:** work phase by phase and stop at the end of every phase for explicit
approval. Do not begin the next phase until the owner says `Lanjutkan Phase N`.

---

## 1. Product purpose

**AI Skill Evidence Builder** is one platform serving two audiences with one shared account and one
shared credit wallet:

1. **Job Seekers** — analyze and enhance a CV without fabricating facts.
2. **HRD / Recruiters** — evidence-based screening of many candidate CVs at once.

Core philosophy: **EVIDENCE BEFORE ASSUMPTION**. The AI extracts evidence; a deterministic Node.js
scoring engine produces the score and ranking. The AI never invents employment history, skills,
metrics, employers, dates or projects, and never silently decides a candidate's fate.

Cross-cutting pillars: one ledger-backed credit wallet (no subscriptions) and a server-enforced
admin role (never "security by hidden URL").

---

## 2. Milestone table

| Phase | Name                               | Status                                                                                   |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| 0     | Repository Audit                   | COMPLETE                                                                                 |
| 1     | Monorepo & TypeScript Foundation   | COMPLETE                                                                                 |
| 2     | Core Backend Architecture          | COMPLETE                                                                                 |
| 3     | Database                           | COMPLETE                                                                                 |
| 4     | Authentication                     | COMPLETE                                                                                 |
| 5     | Credit Economy                     | COMPLETE (top-up purchase deferred to Phase 9)                                           |
| 6     | Free CV Audit                      | COMPLETE                                                                                 |
| 7     | Paid CV Enhancer                   | COMPLETE                                                                                 |
| 8     | CV Templates & Export              | COMPLETE                                                                                 |
| 9     | Payment Architecture               | COMPLETE                                                                                 |
| 10    | Recruiter Requirements             | COMPLETE                                                                                 |
| 11    | Batch Upload                       | COMPLETE                                                                                 |
| 12    | Queue                              | COMPLETE                                                                                 |
| 13    | Evidence Extraction                | COMPLETE (scoring rows are Phase 14)                                                     |
| 14    | Deterministic Scoring              | COMPLETE                                                                                 |
| 15    | Screening Results & Reports        | COMPLETE                                                                                 |
| 16    | Evidence Verification              | COMPLETE (claim-level cross-checking is deferred)                                        |
| 17    | Testimonials                       | COMPLETE                                                                                 |
| 18    | Admin                              | COMPLETE (list screens are API-only for now)                                             |
| 19    | Security Hardening                 | COMPLETE                                                                                 |
| 20    | Testing                            | IN PROGRESS (offline slice done: web workspace green, 176 offline tests; see §7 and §10) |
| 21    | Docker                             | COMPLETE (unbuilt here: no Docker daemon in the agent environment)                       |
| 22    | GitLab CI                          | COMPLETE (pipeline written; never run - no runner/daemon here)                           |
| 23    | Final Documentation & Verification | IN PROGRESS (doc drift guard + deploy runbook done; owner-run verification outstanding)  |

### What each completed phase delivered

Phase 3 was completed first because every later phase depends on the schema. Phase 6 had been built
in dependency order before the stop-at-every-phase workflow was introduced and was resumed and
finished on the owner's `Lanjutkan Phase 6`. Everything below compiles, lints and is executed by the
test suite where marked.

- **Phase 3 (Database) — COMPLETE**: `schema.prisma` (23 models, 20 enums), the initial migration,
  the PGlite harness, repositories (user / credit / pricing / CV), `docs/DATABASE.md`, and tests for
  schema-and-migration drift, the real `prisma migrate deploy` path, CV repository behaviour and
  pricing-override persistence.
- **Phase 4 (Authentication) — COMPLETE, then repaired for real Supabase use**: dev HS256 strategy +
  Supabase JWKS verification, `requireAuth` / `optionalAuth` / `requireAdmin`,
  `GET /api/auth/me`, `POST /api/auth/dev/{sign-up,sign-in}`, `GET|PATCH /api/profile`,
  `POST /api/profile/google/connect`, a profile settings UI and 28 dedicated auth / profile /
  admin-authorization tests. The API decides _whether_ Google linking is allowed and where the
  client returns to; the browser performs the OAuth exchange, because attaching a provider to an
  existing account is only supported by the Supabase browser SDK
  (`supabase.auth.linkIdentity`).
  **Auth repair (after Phase 10)** — the browser side was only a development shell, so the
  Supabase paths could never complete. `auth.tsx` now treats the Supabase session as the source of
  truth (`getSession()` on startup, `onAuthStateChange` token sync, session-aware sign-out), the
  sign-in page gained Google OAuth plus Supabase email/password sign-in and sign-up, Google linking
  runs against the authenticated SDK session, and the API's dev branch falls through to JWKS
  verification instead of shadowing it, merges account flags additively and derives
  `provider: 'GOOGLE'` from `app_metadata.provider` **or** the linked `providers` list. Still
  deferred: Google _unlinking_ (needs the Supabase service-role key), password reset, and the
  verification of the flow against a live Supabase project (§8.14).
- **Phase 5 (Credit Economy) — COMPLETE**: wallet, ledger, pricing (DB overrides + defaults),
  reservations, atomic settlement, refunds, adjustments, plus the credits UI (balance, price list,
  top-up packages, paginated ledger) and 18 tests covering the ledger and the HTTP wire format.
  The **purchase** path is deferred to Phase 9 by dependency: `creditService.grantTopUp` requires a
  settled `PaymentTransaction` and no payment provider abstraction exists yet. Top-up packages are
  listed as "segera hadir" rather than pretending to be purchasable.
- **Phase 6 (Free CV Audit) — COMPLETE**: upload validation, page-aware PDF text extraction, the
  guest flow (0 credits, processed in memory, nothing persisted), signed-in persistence of the
  document + analysis, guest IP rate limiting, the `POST /api/cv/audit` route with history/detail
  reads, and the audit results UI at `/audit` (works signed-out). It also delivered the runtime
  prompt-orchestration slice required by §11.1 for the audit prompt: `prompts/global/*`,
  `prompts/promptBuilder.ts`, `prompts/jobSeeker/auditPrompt.ts`, provider-independent
  `PromptPayload` transport and persisted `JOB_SEEKER_AUDIT_V1` on `AiUsageRecord` and `CvAnalysis`.
  Covered by `tests/cv-audit.test.ts` (11), `tests/prompt-builder.test.ts` (7) and
  `apps/web/src/pages/AuditPage.test.tsx` (5).
- **Phase 7 (Paid CV Enhancer) — COMPLETE**: `POST /api/cv/enhance` (authenticated; multipart PDF
  plus a JSON `options` field) reserves the `CV_ENHANCEMENT` price before the model call and
  settles only when a validated document is stored; any failure releases the hold and marks the row
  `FAILED`. It persists the source document, the `CvEnhancement` row (options, generated document,
  template, credits, reservation link, `promptVersion`) and an `AiUsageRecord` linked by
  `cvEnhancementId`. Reads: `GET /api/cv/enhancements/:enhancementId` (owner-scoped, returns the
  extracted source text) and the enhancement entries in `GET /api/cv/history` (now with
  `promptVersion`). Prompt-orchestration slice: `prompts/jobSeeker/enhancePrompt.ts` with a
  structured job-seeker context block and a consent gate (`useProfileContext`), the provider now
  consumes `PromptPayload` (prompt building left `deepseek.provider.ts`), and
  `CvEnhancement.promptVersion` is stored. The Before vs After UI is at `/enhance` (protected).
  Covered by `tests/cv-enhancement.test.ts` (8), `tests/enhance-prompt.test.ts` (5) and
  `apps/web/src/pages/EnhancePage.test.tsx` (5). Exporting the enhanced CV is deferred to Phase 8
  by dependency.
- **Phase 8 (CV Templates & Export) — COMPLETE**: three HTML/CSS templates
  (`apps/api/src/templates/cv/{atsMinimal,professional,modern}.ts`, accents taken from the shared
  `CV_TEMPLATES` catalogue) render the stored `cvEnhancementDocumentSchema` document, and
  `POST /api/cv/enhancements/:enhancementId/export` reserves `CV_PDF_EXPORT` (1 credit by
  default), renders through the `providers/pdf` interface (Puppeteer/Chromium when
  `PDF_RENDERER=puppeteer`, a deterministic offline renderer otherwise), settles only on success
  and returns the base64 PDF inside the standard JSON envelope. Each export stores a `CvDocument`
  of kind `ENHANCED` (metadata, the SHA-256 of the bytes and a plain-text rendition) and links it
  through `CvEnhancement.resultDocumentId`, so the record stays auditable without keeping the
  bytes. Templates escape every interpolated value and ship a strict CSP; the renderer disables
  JavaScript. The `/enhance` result gained a template picker and a download button. Covered by
  `tests/cv-templates.test.ts` (8), `tests/cv-export.test.ts` (8) and the export case in
  `apps/web/src/pages/EnhancePage.test.tsx` (6 total). Persisting the PDF bytes awaits the
  storage provider (Phase 19/21).
- **Phase 9 (Payment Architecture) — COMPLETE**: `providers/payments/` sits behind a
  `PaymentProvider` interface (`createPayment` + `verifyWebhook`) with an offline
  `MockPaymentProvider` (HMAC-signed notifications, deterministic ids, `MOCKQRIS:` payload)
  and a `MidtransPaymentProvider` Snap adapter that is prepared but never auto-activated
  (`PAYMENT_PROVIDER=mock` stays the default, and the adapter refuses to run without
  `MIDTRANS_SERVER_KEY`). `POST /api/payments/checkout` resolves the amount from shared
  configuration (`TOPUP_PACKAGES`, `MIN_TOPUP_IDR`, `CREDIT_IDR_VALUE` - no literals),
  inserts a `PENDING` `PaymentTransaction`, then asks the provider for an instrument.
  `POST /api/payments/webhook/{mock,midtrans}` verifies the signature, archives the delivery
  in `PaymentWebhookEvent` (unique `event_key` makes a redelivery a `DUPLICATE` no-op), checks
  amount and status, and only then settles through `creditService.grantTopUp` (ledger
  idempotency key `payment:<id>`, so a payment can never credit twice). `FAILED`/`EXPIRED`
  never downgrade a completed payment; `REFUNDED` is recorded without auto-reversing credits;
  overdue `PENDING` rows become `EXPIRED` via `PaymentService.expireOverdue` (also applied
  lazily on reads) and can still be settled by a later signed notification. `GET /api/payments`
  and `GET /api/payments/:paymentId` are owner-scoped, and
  `POST /api/payments/:paymentId/simulate` drives the offline provider through the real webhook
  path (dev only, refused in production). The credits UI now has working top-up buttons, a
  pending-payment panel (order id, amount, expiry, QR payload, simulate button) and a top-up
  history. Covered by `tests/payment-provider.test.ts` (25, executed),
  `tests/payments-api.test.ts` (26, written but not executed here) and
  `apps/web/src/pages/CreditsPage.test.tsx` (8, executed).

- **Phase 10 (Recruiter Requirements) — COMPLETE**: `prompts/hrd/screeningPrompt.ts` composes
  `HRD_SCREENING_V1` (`buildHrdScreeningPrompt`) with the frozen recruiter-preference version and
  scoring configuration as labelled JSON context, the requirements as a structured task block, and
  the job description, candidate CV and verified external evidence as delimited untrusted documents
  last; the feature prompt states that the model extracts evidence only and never scores, ranks or
  decides. `ScreeningJob.promptVersion` (default `HRD_SCREENING_V1`) was folded into the initial
  migration alongside `preferenceVersion`/`scoringConfigurationVersion`/`requirementVersion`, so a
  job records all four versions together. New `repositories/screening.repository.ts`,
  `services/recruiter-preference.service.ts` and `services/screening.service.ts` expose
  `GET/PUT /api/screening/preferences` (versioned saves with immutable
  `RecruiterPreferenceVersion` snapshots written in the same transaction; a read never writes and
  returns version 0 plus the shared defaults until the recruiter saves), `GET
/api/screening/preferences/versions`, `POST /api/screening/jobs` (state `CREATED`, requirements
  with 1-based `sortOrder` and schema defaults, inherited or overridden category weights/notes,
  a `STATE_CHANGED` `ScreeningJobEvent`), `GET /api/screening/jobs`, `GET
/api/screening/jobs/:jobId`, `PATCH /api/screening/jobs/:jobId` (cancel only) and `GET
/api/screening/jobs/:jobId/progress`. No credits are reserved: candidates, reservation and
  queueing are Phases 11-12. Recruiter UI is deferred to Phase 11/15, when a job can actually
  receive candidates and show results. Covered by `tests/screening-contracts.test.ts` (12,
  executed), `tests/screening-prompt.test.ts` (9, executed) and `tests/screening-api.test.ts`
  (20, written but not executed here).

- **Phase 11 (Batch Upload) — COMPLETE**: `POST /api/screening/jobs/:jobId/candidates`
  accepts up to `LIMITS.MAX_SCREENING_CVS` (50) PDFs, or one ZIP, as the multipart field
  `files`; `screeningBatchService` validates each file, extracts its text (no OCR: a scanned
  PDF is reported, not guessed), stores the candidates as `QUEUED` with `cv_text`/`text_hash`/
  `page_count`, and returns partial success - accepted files plus a per-file `rejected` list
  carrying the shared error code. `utils/zip.ts` implements the archive hardening that the
  phase description assumed existed (entry count, total uncompressed size, per-entry and
  per-PDF ceilings, compression-ratio zip-bomb guard, encrypted archives, OS metadata
  entries) using `yauzl`, which was installed but unused. Archive-level violations abort the
  request; single-file failures stay recoverable. `HRD_SCREEN_PER_CV x accepted` is reserved
  through the pricing service _before_ the batch is written and linked to the job
  (`reservationId` + `creditsReserved`), released again if persistence fails, and left
  `ACTIVE` for Phases 12-13 to settle per candidate. The job moves to `QUEUED` and the batch
  is one transaction (candidates + counters + `CANDIDATE_QUEUED`/`STATE_CHANGED` events).
  A second batch on the same job is a `409`, so a job owns exactly one reservation.
  `GET /jobs/:jobId/candidates` lists the batch (metadata only - never `cv_text`), both
  owner-scoped. No schema change was needed. Covered by `tests/zip.test.ts` (10, executed),
  the batch-upload block in `tests/screening-contracts.test.ts` (18 total, executed) and
  `tests/screening-batch.test.ts` (14, written but not executed here - it binds sockets).

- **Phase 12 (Queue) — COMPLETE (plumbing; the work unit itself is Phase 13)**: the queue
  boundary lives in `queues/` behind one `ScreeningQueue` interface with two drivers -
  `BullMqScreeningQueue` (BullMQ + `ioredis`, selected when `REDIS_URL` is set, retries
  from `SCREENING_JOB_ATTEMPTS`/`SCREENING_JOB_BACKOFF_MS`, stable `${jobId}:${candidateId}`
  job ids) and `InProcessScreeningQueue` (bounded concurrency, the same attempt/backoff
  policy, exact `waitForIdle()`), so development and tests never need Redis. A batch upload
  enqueues its candidates after the rows and the hold are committed; a broker failure is
  recorded as an `ERROR` event instead of rolling back a valid batch.
  `workers/screening.processor.ts` is the per-candidate seam: Phase 12 ships only an
  _unavailable_ processor that refuses to run, so nothing can be marked `COMPLETED` before
  the real extraction exists. `services/screening-runner.service.ts` owns the plumbing:
  `QUEUED -> PROCESSING` (attempts incremented per try), retry backoff, `CANDIDATE_RETRIED`
  `CANDIDATE_COMPLETED`/`CANDIDATE_FAILED` events, a terminal state derived from the counts
  (`COMPLETED` / `PARTIALLY_COMPLETED` / `FAILED`), and one settlement of the
  `HRD_SCREEN_PER_CV` hold for exactly the candidates that were delivered - `settle()`
  charges `unitPrice x completed` and releases the remainder in the same atomic step, so a
  partial or fully failed batch is never billed for work that did not happen. A redelivered
  candidate is a no-op, so at-least-once delivery cannot double-charge. `PATCH
/screening/jobs/:jobId` (cancel) now fails the remaining candidates and releases the hold
  instead of leaking an `ACTIVE` reservation. `npm run dev:worker` (and `start:worker`)
  finally exist; with Redis the worker is a separate process, without it `server.ts` drains
  the in-process queue itself. `GET /progress` is meaningful now. No schema change was
  needed. Covered by `tests/screening-queue.test.ts` (12, executed) and
  `tests/screening-queue-flow.test.ts` (7, written but not executed here).

- **Phase 13 (Evidence Extraction) — COMPLETE**: the per-candidate work the queue was missing.
  `prompts/hrd/evidenceExtractionPrompt.ts` now owns the real composed call
  (`HRD_EVIDENCE_EXTRACTION_V1`, temperature 0.05): global policy + feature prompt in the system
  role, the job's frozen preference/scoring context and requirement parameters as labelled JSON,
  then the job description and CV as delimited untrusted documents last. `hrd/screeningPrompt.ts`
  keeps the job-level `HRD_SCREENING_V1` id (persisted on `ScreeningJob.promptVersion`) and
  delegates to the same composition, so the two versions cannot drift; the transitional
  `prompts/screening-evidence.prompt.ts` and the provider's `promptFromParts` use for screening
  are gone. `extractScreeningEvidence` is now prompt-transport like the audit/enhancement, and the
  mock provider reads the criteria and CV back out of the composed payload, so tests exercise the
  same composition path as production. `utils/evidence.ts` grounds every quote against the stored
  CV text before anything is persisted: an unverifiable quote is dropped, a `FOUND` that loses all
  its quotes is downgraded to `UNCERTAIN` (never upgraded), and page numbers are not persisted
  because Phase 11 stores the joined text without its per-page breakdown.
  `services/screening-evidence.service.ts` implements the Phase 12 `CandidateProcessor` seam:
  frozen preference snapshot -> prompt -> provider -> `screeningEvidenceResponseSchema` validation
  -> grounding -> `AiUsageRecord` (`HRD_SCREEN_PER_CV`, linked to job + candidate) -> result. The
  candidate row keeps `summary`/`gaps`/`uncertainties` and a versioned `analysis_json` envelope
  (prompt/preference/scoring/requirement versions + grounding summary + grounded evidence), so one
  row stays auditable without a join; the file-derived `candidateName` is replaced only when the
  model reports a name from the document. Per-criterion `ScreeningCriterionResult` rows are
  deliberately left to Phase 14, because `earnedScore`/`normalisedWeight` are non-nullable and only
  the deterministic engine may write a score. **No migration was needed** (see §8.23).
  Covered by `tests/evidence-extraction-prompt.test.ts` (6, executed),
  `tests/screening-evidence.test.ts` (13, executed - including a real mock-provider round trip) and
  the updated `tests/screening-queue-flow.test.ts` (8, written but not executed here).

- **Phase 14 (Deterministic Scoring) — COMPLETE**: the AI never scores, and now something else
  does. `services/scoring/engine.ts` is a pure, offline rule set: an uncorroborated verdict loses
  credit (`FOUND` below `UNCERTAIN_CONFIDENCE_THRESHOLD` 0.45, or with no stored quote, becomes
  `UNCERTAIN` and can never be upgraded), each criterion earns a fixed outcome (`FOUND` 100,
  `UNCERTAIN` 50, `NOT_FOUND` 0), influence is the requirement weight shaped by its category
  weight and normalised to fractions of one, and the candidate score is the weighted sum rounded
  to an integer - so `earnedScore x normalisedWeight` in `screening_criterion_results` reproduces
  the stored score exactly. Eligibility follows the shared thresholds
  (`HIGH_MATCH` 75 / `CONSIDER` 55 / `LOW_MATCH`), except that any unmet hard requirement makes the
  candidate `REQUIREMENT_NOT_MET` **while keeping them in the results**, and `strengths`/`gaps`/
  `uncertainties` are derived from the criterion outcomes instead of the model's prose. The queue
  runner scores before it marks a candidate `COMPLETED` (so a completed candidate either has
  scores or an explicit unscored state), `services/scoring/scoring.service.ts` re-validates the
  stored envelope on read and writes through `ScreeningRepository.replaceCandidateScores` in one
  transaction (delete + recreate, so re-scoring can never duplicate a verdict or leave a stale
  one), and a candidate with no envelope stays unscored (`score`/`eligibility_status` NULL) rather
  than receiving a fabricated zero. `verificationStatus` stays `NOT_CHECKED` until Phase 16.
  **No migration was needed** - the Phase 3 columns were already sufficient. Covered by
  `tests/scoring-engine.test.ts` (14, executed) and two new cases in
  `tests/screening-queue-flow.test.ts` (10 total, written but not executed here).

- **Phase 15 (Screening Results & Reports) — COMPLETE**: the recruiter-facing half of the
  pipeline. `services/screening-report.service.ts` reassembles the stored candidates,
  criterion results and evidence into `screeningResultPayloadSchema` (ranked by the stored
  deterministic score with unscored candidates last, per-criterion evidence and the job's
  frozen versions, `unmetHardRequirements` derived from the criterion rows, and the shared
  methodology note) and renders that same payload as CSV (`csv-stringify`, BOM for Excel) or
  PDF (`templates/report/screeningReport.ts` + the existing renderer, with every interpolated
  candidate name, criterion and quote escaped). The three new routes are
  `GET /jobs/:jobId/results`, `POST /jobs/:jobId/reports` and `GET /jobs/:jobId/reports`;
  reports are recorded as `GeneratedReport` rows (metadata + SHA-256, `storagePath` null)
  and returned inline as base64, exactly like the CV export, and are **not billed
  separately** because the pricing catalogue has no report feature key. The web app gained
  the recruiter UI it had been deferring: `/screening` (job list, draft form with one
  criterion per line, saved preferences opt-in) and `/screening/:jobId` (batch upload,
  polled progress, ranked results with per-criterion evidence behind a disclosure, an
  explicit `Syarat wajib belum terpenuhi` note that keeps the candidate visible, `belum
dinilai` for an unscored candidate, report export and history). `docs/API.md` and
  `docs/ARCHITECTURE.md` were written in this phase; no migration was needed. Covered by
  `tests/screening-report-template.test.ts` (9, executed - escaping, CSV shape, file names),
  `apps/web/src/pages/{ScreeningPage,ScreeningJobPage}.test.tsx` (9, executed) and
  `tests/screening-results-api.test.ts` (7, written but not executed here).

- **Phase 16 (Evidence Verification) — COMPLETE**: the last slice of the runtime
  prompt-orchestration requirement. `prompts/hrd/portfolioVerificationPrompt.ts` composes
  `HRD_PORTFOLIO_VERIFICATION_V1` (policy + feature prompt, the URL as a labelled data block,
  the fetched page delimited and last) and `analyzePortfolio` now only transports a
  `PromptPayload`; the transitional `promptFromParts` helper and the inline prompt inside
  `deepseek.provider.ts` are both gone, so every feature prompt is a versioned module.
  `providers/http/` adds the outbound boundary: pure SSRF guards (scheme, internal hostnames,
  every private/loopback/link-local/CGNAT/multicast range, IPv4-mapped forms, an address that
  fails to resolve, content-type allowlist, markup stripping) plus a `GuardedHttpProvider`
  that resolves every address before fetching, re-validates each redirect hop (max 3), and
  reads at most `EXTERNAL_FETCH_MAX_BYTES` with a hard timeout, and an offline `MockHttpProvider`
  selected by `OUTBOUND_HTTP_PROVIDER` (default `mock`, forced in tests). `EVIDENCE_VERIFICATION`
  is now real: `services/portfolio-verification.service.ts` pulls the links out of the stored CV
  text, reuses a 24-hour `IntegrationEvidenceSnapshot` instead of re-fetching, reserves the
  per-CV price once, fetches and summarises each link, stores candidate-level `EvidenceItem`
  rows with their verification status, and settles only when at least one page was actually
  verified (a failed or empty page releases the whole hold). LinkedIn is deliberately never
  fetched - it is recorded as `LINKEDIN_SELF_REPORTED`/`UNVERIFIED`. The new route is
  `POST /jobs/:jobId/candidates/:candidateId/verification`, and the results UI shows the
  verified link evidence with a "Verifikasi tautan" action. No migration was needed. Covered by
  `tests/http-guards.test.ts` (13, executed), `tests/portfolio-verification.test.ts` (9,
  executed) and `tests/portfolio-prompt.test.ts` (4, executed).

- **Phase 17 (Testimonials) — COMPLETE**: social proof that cannot be faked. `POST
/api/testimonials` (session) stores the review as `PENDING`; `GET /api/testimonials` is
  public but filtered to `APPROVED` in SQL, so a pending or rejected review can never leak;
  `GET /api/testimonials/mine` lets the author see their own status, and
  `GET /api/testimonials/moderation` + `PATCH /api/testimonials/:id/moderation` are
  server-enforced admin routes (`requireAdmin`, not a hidden URL). A review may name a
  completed enhancement, which must belong to the author (otherwise 404) and may only be
  reviewed once (409), which is what keeps the queue tied to real usage; `displayName` falls
  back to the profile name and **never** to the account email. The landing page links to
  `/testimonials`, which lists approved reviews with a five-star rendering, and a
  `TestimonialForm` sits beside a finished enhancement result. No migration was needed
  (`testimonials` already existed with its moderation columns). Covered by
  `apps/web/src/pages/TestimonialsPage.test.tsx` (4, executed) and
  `tests/testimonials-api.test.ts` (5, written but not executed here).

- **Phase 18 (Admin) — COMPLETE**: `/api/admin/*` behind `requireAuth()` + `requireAdmin()`
  mounted once on the router, so a route cannot ship unguarded and the role is re-read from the
  database on every request. `GET /overview` returns the payload the shared schema always
  described (users, credits, revenue, AI cost/margin, screening, testimonials, system) plus the
  current price list, and the reporting lists cover users with wallet balances, the system-wide
  ledger, payments, webhook deliveries (including rejected signatures), AI usage with provider
  cost, all screening jobs with their owner, and failed candidates with the reason. The two
  mutations are the only writes: `PUT /pricing/:feature` goes through the pricing service (so the
  shared defaults and the 30-second cache stay the single source of truth, and
  `updatedByUserId` records who changed it) and `POST /users/:userId/credits` goes through
  `CreditService.adjust`, so an admin gets no second way to move a balance - the ledger row is
  an `ADJUSTMENT` referencing the admin. Role changes refuse a self-demotion (409), which would
  otherwise lock the only admin out of the console. The console UI at `/admin` shows the
  aggregates, edits prices, moderates the Phase 17 testimonial queue and lists failed candidates
  and recent jobs; the remaining lists are reachable by API and documented as such. The admin
  link on the landing page appears only for an admin, and the page itself is a convenience - the
  server is the boundary. No migration was needed. Covered by
  `apps/web/src/pages/AdminPage.test.tsx` (4, executed) and `tests/admin-api.test.ts` (5, written
  but not executed here).

- **Phase 19 (Security Hardening) — COMPLETE**: `docs/SECURITY.md` is written (the last owed
  document) - assets, the threat model with the control that implements each claim, privacy,
  an explicit accepted-risk table and a production checklist. The one promise the code comment
  made but could not keep is now kept: `middleware/rate-limit.ts` has a `RateLimitStore`
  interface with an in-memory implementation (single container and development) and a Redis one
  selected by `REDIS_URL`, where the increment and first-expiry run as one Lua script so replicas
  cannot double-start a window. A store outage fails open with a warning, which is documented as
  an accepted trade-off rather than hidden. Testimonial submission also gained a per-account cap
  (5 per day) on top of the one-per-enhancement rule (§8.40 resolved). Log redaction already
  covered authorization headers, cookies, webhook signatures, tokens, CV text and provider keys
  and is now documented; the storage decision stays "streamed, metadata only" with the row's
  SHA-256 as the audit trail. Covered by `tests/rate-limit.test.ts` (9, executed).

- **Phase 20 (Testing) — IN PROGRESS; the offline slice is done.** The three web suites that had
  been failing since Phase 11 were not stale assertions: `apps/web/vitest.config.ts` let Vite load
  the developer's root `.env`, so a configured `VITE_SUPABASE_*` silently switched the whole web
  suite to the Supabase auth strategy, where no session exists and every dev-token test hung. The
  config now pins those variables to empty strings (`define`), any test that wants Supabase opts in
  explicitly, and **all 13 web suites / 67 tests pass** (§8.15 and §8.33 resolved). On the API
  side, the mock provider's declared-but-unused `invalidJsonNext` behaviour is now honoured by all
  four provider methods, so the "model returned something no schema accepts" path is exercised
  instead of assumed: `tests/provider-behaviour.test.ts` (8, executed) covers outage, 429 and
  invalid output as typed errors, the four result shapes + prompt version ids, and the
  inconclusive-page case, and `tests/screening-evidence.test.ts` gained a case proving an invalid
  provider response stores no envelope and records no provider cost. `tests/shared-weights.test.ts`
  (7, executed) covers the two exported `@aseb/shared` weight helpers, which nothing calls today
  (§8.44). E2E specs for the guest audit and the recruiter batch flow were written
  (`apps/web/e2e/{audit,screening}.spec.ts` + a PDF fixture helper) but cannot run without
  Chromium. Coverage for the offline subset was 60.1% statements; **the repo-wide figure is now
  measured** on the owner's machine - 83.02% statements / 84.04% lines over 58 files and 490 tests
  (see §7).

- **Phase 21 (Docker) — COMPLETE (files written, never built here)**: `apps/api/Dockerfile` is a
  four-target multi-stage build - `deps` (full install with `--ignore-scripts`, so husky and the
  Chromium download stay out), `build` (`build:shared` -> `prisma generate` -> `tsc`, in that
  order, because the generated client is git-ignored and the compiler needs it), `migrate`
  (`prisma migrate deploy` as a one-shot service) and `runtime` (non-root `node` user, only the
  compiled output, the generated client, the workspace symlinks and the migration files, with a
  HEALTHCHECK that hits `/api/health`). `apps/web/Dockerfile` builds Vite in one stage and serves
  it from `nginx:1.27-alpine` with `apps/web/nginx.conf`, which proxies `/api` to the API service
  so the browser stays same-origin and the CORS allowlist does not have to grow. `docker-compose.yml`
  brings up Postgres and Redis (with healthchecks and named volumes), a `migrate` service that the
  API and worker wait for via `service_completed_successfully`, the API, the worker (same image,
  `node dist/worker.js`) and the web container. All defaults are the offline providers
  (`AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, `PDF_RENDERER=mock`, `OUTBOUND_HTTP_PROVIDER=mock`,
  `AUTH_DEV_MODE=true`), and configuration is read **only** from `DOCKER_*` variables - the root
  `.env` used by `npm run dev` is never consulted, so a developer's real Midtrans/Supabase
  credentials cannot leak into a container build. `.dockerignore` excludes `.env*`,
  `node_modules`, build output, `coverage`, `docs` and the frozen `legacy/` prototype. Verified in
  this environment: the compose file parses (YAML + expected services/healthchecks/dependency
  graph), every path the Dockerfiles copy and every npm script they invoke exists. **Not verified:
  an actual `docker build`/`compose up`** - there is no Docker daemon here (§8.46).

- **Phase 22 (GitLab CI) — COMPLETE (pipeline written, never executed)**: `.gitlab-ci.yml` mirrors
  the local gates - `quality` (lint, typecheck), `test` (Vitest: unit + PGlite integration, plus
  the production builds), `e2e` (Playwright against the real API, a throwaway Postgres and the mock
  providers) and `images` (`docker build` for both images, pushing only from a git tag). `npm ci`
  runs with scripts **enabled** for a reason discovered while writing this: `@prisma/engines` needs
  its postinstall to fetch the schema engine, so the `--ignore-scripts` flag in the Phase 21
  Dockerfiles was a latent build breaker and has been removed there too (Chromium and husky stay
  disabled via `PUPPETEER_SKIP_DOWNLOAD` and `HUSKY=0`). The cache is keyed on `package-lock.json`,
  provider calls stay offline in every job, and no job deploys. `apps/web/playwright.config.ts`
  gained `webServer` entries so the E2E suite starts both servers itself (reusing a developer's
  running ones locally), which is what makes the `e2e` job self-contained. Also corrected three
  documents and the test harness's own error message, which claimed `TEST_DATABASE_URL` would point
  the suites at a real PostgreSQL instance - it was never implemented (§8.47). Verified here: the
  pipeline YAML parses with the intended six jobs, five stages, services and `extends` targets;
  Playwright loads the config and lists all four specs; `npx prisma generate` and every referenced
  npm script exist. Not verified: an actual pipeline run, and the browser suite (no Chromium, §8.45).

- **Phase 23 (Final Documentation & Verification) — IN PROGRESS; the agent-doable slice is done.**
  Instead of a one-off manual read-through, the mechanical claims are now guarded: `npm run
verify:docs` (`scripts/verify-docs.mjs`, wired into the CI `quality` stage as the `docs` job)
  compares the registered Fastify-style route list against `docs/API.md`, every `.env.example` key
  against the API's environment schema (with an explicit, self-verifying allowlist for the browser
  and installer variables), the prompt version registry against `docs/AI_PROMPTS.md`, and the
  cross-references between documents - including a check that no file in `docs/` is an orphan. It
  currently reports **57 routes, 54 environment keys and 6 prompt versions in sync**. A missing
  deploy runbook was the obvious gap that closed: `docs/DEPLOYMENT.md` covers the two ways to go
  online (the Phase 21 container stack or managed pieces), the environment table per environment,
  the database/pooler details, a six-step post-deploy smoke test, rollback and the launch limits
  that still apply (§8.31, §8.35, §8.42, §8.45, §8.46, §8.48). **No deployment was performed**: the
  repository has never been deployed anywhere, no CI job deploys, and the first production run is
  explicitly the owner's (AGENTS.md golden rule 5).

---

## 3. Repository structure (as it exists today)

```
apps/api            Express 5 + TypeScript API (ESM, NodeNext)
  prisma/           schema.prisma, migrations/20260926000000_init, prisma.config.ts
  src/config        env.ts (validated), load-env.ts, ai-pricing.ts
  src/db            prisma.ts (lazy client + @prisma/adapter-pg)
  src/middleware    request-context, error-handler, validate, auth, rate-limit, upload
  src/providers/ai  types, deepseek.provider, mock.provider, index (factory)
  src/providers/pdf types, puppeteer.provider (Chromium), mock.provider (offline), index (factory)
  src/providers/payments  types (PaymentProvider interface), mock.provider (HMAC-signed, offline),
                    midtrans.provider (Snap adapter, never auto-activated), index (factory)
  src/providers/http  guards (pure SSRF rules), guarded.provider (DNS check, redirect hops,
                    size/timeout caps), mock.provider (offline), index (factory)
  src/templates/cv  html (escape + CSP + page shell), sections, atsMinimal, professional, modern,
                    index (registry, file name, plain-text rendition)
  src/templates/report  screeningReport.ts (escaped HTML + CSV rows + file name)
  src/prompts       types (version registry), promptBuilder.ts (layer composition),
                    global/ (globalPolicy, antiFabricationPolicy, promptInjectionPolicy,
                    evidencePolicy), jobSeeker/auditPrompt.ts, jobSeeker/enhancePrompt.ts,
                    hrd/evidenceExtractionPrompt.ts (HRD_EVIDENCE_EXTRACTION_V1 - the real
                    per-candidate call plus the shared composition), hrd/screeningPrompt.ts
                    (HRD_SCREENING_V1 - the job-level context id),
                    hrd/portfolioVerificationPrompt.ts (HRD_PORTFOLIO_VERIFICATION_V1)
  src/repositories  user, credit, pricing, cv, payment, screening, testimonial, admin
  src/services      auth, profile, credit, pricing, cv-audit, cv-enhancement, cv-export,
                    pdf-extraction, ai-usage, payment, recruiter-preference, screening,
                    screening-batch, screening-runner, screening-evidence, screening-report,
                    portfolio-verification, testimonial, admin
  src/services/scoring  engine.ts (pure deterministic rule set), scoring.service.ts
                    (envelope re-validation + transactional persistence)
  src/queues        types (ScreeningQueue interface + driver selection), in-process.queue,
                    bullmq.queue, index (factory + process-wide singleton)
  src/workers       screening.processor (CandidateProcessor seam + test override registry),
                    screening.worker (attaches the handler)
  src/worker.ts     standalone worker entry (`npm run dev:worker` / `start:worker`)
  src/routes        index (mounts /health /auth /profile /cv /credits /payments /screening
                    /testimonials /admin),
                    health, auth, profile, cv, credit, payment, screening, testimonial, admin
  src/controllers   health, auth, profile, cv, credit, payment, screening, testimonial, admin
  src/utils         errors, logger, jwt, text, values, hash, evidence, file-validation, zip
  src/app.ts        createApp() — helmet, CORS allowlist, pino-http, error handling
  src/server.ts     listen + graceful shutdown (logs and warns about missing config)
  tests/            db-harness, database-schema, migrate-deploy, cv-repository, cv-audit,
                    cv-enhancement, cv-export, cv-templates, prompt-builder, enhance-prompt,
                    pricing-repository, credit-ledger, credits-api, auth, profile,
                    admin-authorization, payment-provider, payments-api, screening-contracts,
                    screening-prompt, screening-api, screening-batch, screening-queue,
                    screening-queue-flow, evidence-extraction-prompt, screening-evidence,
                    scoring-engine, screening-report-template, screening-results-api, zip, app,
                    http-guards, portfolio-prompt, portfolio-verification,
                    testimonials-api,
                    admin-api,
                    auth-identity-flags, jwt-supabase-token
                    + helpers/db.ts (PGlite harness), helpers/auth.ts, helpers/env.ts
                    + helpers/pdf.ts (offline PDF fixtures), helpers/zip.ts (offline ZIP fixtures)
  tsconfig.tests.json  typecheck project that includes tests/ (api tsconfig.json excludes them)
  Dockerfile        multi-stage build; targets deps / build / migrate / runtime (Phase 21)
apps/web            React 19 + Vite 8 + Tailwind v4
  src/lib           api.ts (Zod-validated fetch + single/multi-file multipart upload), auth.tsx
                    (Supabase session or
                    dev-token fallback + profile query), profile.ts (mutations),
                    credits.ts (wallet / pricing / ledger queries),
                    cvAudit.ts (free-audit mutation), cvEnhance.ts (paid enhancement mutation),
                    cvExport.ts (paid PDF export mutation + download helper),
                    screening.ts (screening queries/mutations + report download),
                    testimonials.ts (public list, own reviews, submit),
                    admin.ts (console queries, moderation, pricing override),
                    supabase.ts (code-split browser SDK: session, sign-in/sign-up, Google OAuth and
                    identity linking)
  src/pages         HomePage, SignInPage, ProfilePage, CreditsPage, AuditPage, EnhancePage,
                    ScreeningPage, ScreeningJobPage, TestimonialsPage (+ TestimonialForm),
                    AdminPage
  src/components    ProtectedRoute
  src/App.tsx       providers (TanStack Query, auth) + React Router 7 routes
  e2e/              Playwright specs
  Dockerfile        Vite build served by nginx; nginx.conf proxies /api (Phase 21)
packages/shared     Zod contracts, enums, credit defaults, error codes, formatting helpers
docs/               DATABASE.md (Phase 3), AI_PROMPTS.md (runtime prompt architecture), API.md and
                    ARCHITECTURE.md (Phase 15), SECURITY.md (Phase 19), DEPLOYMENT.md (Phase 23)
legacy/             Frozen pre-migration prototype (reference only — never import)
```

Root-level, added by Phase 21: `docker-compose.yml` (db, redis, migrate, api, worker, web) and
`.dockerignore` (keeps `.env*`, `node_modules`, build output, `docs/` and `legacy/` out of the
build context). Phase 22 added `.gitlab-ci.yml` (quality, test, build, e2e, images).

All six documents are written (`DATABASE`, `AI_PROMPTS`, `API`, `ARCHITECTURE`, `SECURITY`,
`DEPLOYMENT`) and `npm run verify:docs` keeps the mechanical claims - routes, environment
variables, prompt versions, cross-references and orphan documents - in sync with the code.

---

## 4. Tech stack (installed and working)

| Concern  | Choice                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language | TypeScript 6.0.3, `strict` + `noUncheckedIndexedAccess`; ESM with NodeNext in api/shared                                                                                |
| Backend  | Node 24, Express 5, Zod 4, Pino 10 (+ pino-http), helmet, multer                                                                                                        |
| Frontend | React 19, Vite 8, React Router 7, TanStack Query 5, Tailwind CSS 4                                                                                                      |
| Database | PostgreSQL via Prisma 7 + `@prisma/adapter-pg` (connection URLs live in `prisma.config.ts`)                                                                             |
| Auth     | Supabase Auth in the browser (Google OAuth + email/password, session in the SDK) verified by the API through JWKS (`jose`); dev HS256 fallback gated by `AUTH_DEV_MODE` |
| AI       | DeepSeek through the OpenAI-compatible SDK, behind an `AIProvider` interface                                                                                            |
| PDF in   | `pdf-parse` v2 (page-aware; text PDFs only, no OCR by design)                                                                                                           |
| PDF out  | Puppeteer + HTML/CSS templates; `PDF_RENDERER=mock` keeps dev/tests offline (Phase 8)                                                                                   |
| Queue    | BullMQ + ioredis installed; no driver implemented yet (Phase 12)                                                                                                        |
| Tests    | Vitest 5 + Supertest 7 + React Testing Library; Playwright configured                                                                                                   |
| Quality  | ESLint 10 (flat) + typescript-eslint 8 + Prettier 3 + husky/lint-staged                                                                                                 |

---

## 5. Commands

```bash
npm install                 # install every workspace
cp .env.example .env        # then fill in values; .env is git-ignored

npm run dev:api             # API only  -> http://localhost:4000
npm run dev:web             # web only  -> http://localhost:5173
npm run dev                 # both together (concurrently)

npm run lint                # ESLint over the whole repo
npm run typecheck           # builds shared, generates Prisma client, then tsc --noEmit per workspace
npm run test                # Vitest (all projects)
npm run build               # production builds for shared + api + web
npm run test:e2e            # Playwright (needs: npx playwright install chromium)
npm run gen                 # prisma generate
npm run db:migrate          # prisma migrate dev (needs DATABASE_URL / DIRECT_URL)
npm run db:deploy           # prisma migrate deploy
npm run format              # prettier --write .
```

Notes:

- `npm run dev:worker` / `npm run start:worker` exist as of Phase 12 and run `src/worker.ts`.
  With `REDIS_URL` set they consume the shared BullMQ queue; without it there is no shared
  queue to consume, so the entry point warns and exits and `server.ts` drains the in-process
  queue inside the API process instead.
- `typecheck`, `test` and `build` regenerate the Prisma client and the shared build automatically, so a
  fresh clone works with `npm install && npm run test`.
- `npm run typecheck` also typechecks the API test suite through
  `apps/api/tsconfig.tests.json`; `apps/api/tsconfig.json` excludes `tests/` on purpose (it drives
  the production build).
- The API integration tests bind a local TCP socket (PGlite's Postgres-wire server and SuperTest).
  Restricted sandboxes that forbid listening sockets must run them unsandboxed or point
  `TEST_DATABASE_URL` at a real PostgreSQL instance. The harness prints those instructions on failure.

---

## 6. Environment variables

Categories (full placeholders in `.env.example`): core (`NODE_ENV`, `PORT`, `API_URL`,
`FRONTEND_URL`, `CORS_EXTRA_ORIGINS`, `LOG_LEVEL`), database (`DATABASE_URL`, `DIRECT_URL`), Supabase
(`SUPABASE_*`), auth dev fallback (`AUTH_DEV_MODE`, `AUTH_DEV_JWT_SECRET`, `ADMIN_EMAILS`), AI
(`AI_PROVIDER`, `DEEPSEEK_*`, `AI_WORKER_CONCURRENCY`, `AI_MARKUP_MULTIPLIER`), queue (`REDIS_URL`),
uploads/limits (`MAX_PDF_BYTES`, `MAX_SCREENING_CVS`, `GUEST_AUDIT_RATE_LIMIT`, …), payments
(`PAYMENT_PROVIDER`, `MIDTRANS_*`, `PAYMENT_MOCK_WEBHOOK_SECRET`), business (`MIN_TOPUP_IDR`,
`CREDIT_IDR_VALUE`), integrations (`GITHUB_*`, `PORTFOLIO_VERIFICATION_ENABLED`), storage
(`SUPABASE_STORAGE_*`), rendering (`PDF_RENDERER`, `PUPPETEER_*`).

Validation lives in `apps/api/src/config/env.ts`: production refuses to start with missing mandatory
configuration or with `AUTH_DEV_MODE=true`; development starts with loud warnings instead.

Supabase connection detail (learned the hard way during the first real deploy attempt). Three
separate problems, each with its own fix:

1. **`pg` does not negotiate TLS unless the connection string asks for it.** `@prisma/adapter-pg`
   hands the URL straight to `pg`, and `pg` reads the CA store bundled with Node. Supabase's
   Supavisor pooler chain is not in that store, so both `?sslmode=verify-full` and `?sslmode=require`
   fail at runtime with `P1011 / TlsConnectionError: self-signed certificate in certificate chain`
   (in `pg`, `require` is only an alias for `verify-full`). The runtime URL therefore needs
   **`DATABASE_URL=...?sslmode=no-verify`** - `pg`'s own extension, which sets
   `rejectUnauthorized: false` (traffic is still encrypted, the CA is just not verified).
2. **The two URLs are read by different drivers, so they need different modes.** `prisma migrate`
   uses Prisma's native engine, which reads the _OS_ trust store and honours `?sslmode=verify-full`
   (the engine does not know `no-verify`, so that value must never be used on `DIRECT_URL`).
   Keep `DIRECT_URL=...?sslmode=verify-full`.
3. **Prisma Migrate must use the session pooler** (port 5432 on the `...pooler.supabase.com` host)
   rather than the direct host `db.<ref>.supabase.co`, which is IPv6-only and answers `P1001` on
   IPv4 networks. The transaction pooler on port 6543 stays the runtime `DATABASE_URL`.

Symptom map if this regresses: `P1001` on the direct host = IPv6; `P1011` /
"self-signed certificate in certificate chain" = a runtime URL using `verify-full` or `require`;
admin-configured-but-unreachable database = project paused on the free tier.

### Authentication wiring (Supabase + offline development)

Two credential authorities exist. Which one is used is decided by configuration, never by runtime
chance:

- **Supabase** is the production path. `SUPABASE_URL` + `SUPABASE_ANON_KEY` (and the browser mirrors
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) point at the project. The browser performs Google
  OAuth (`supabase.auth.signInWithOAuth`) and email/password (`signInWithPassword` / `signUp`), keeps
  the session in the SDK and sends the access token as `Authorization: Bearer …`. The API verifies
  it against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` with issuer
  `${SUPABASE_URL}/auth/v1` and audience `authenticated`, then upserts the user row. The project's
  JWT signing keys must be asymmetric or that endpoint returns no keys. `SUPABASE_SERVICE_ROLE_KEY`
  is server-only, is never prefixed `VITE_`, and today is required only by production validation
  (reserved for unlinking and storage). The Google client id/secret live in the Supabase dashboard
  and are deliberately absent from this repository's environment.
- **Dev HS256** is the offline default (`AUTH_DEV_MODE=true`). The local endpoints
  `POST /api/auth/dev/{sign-up,sign-in}` issue a 7-day HS256 token signed with
  `AUTH_DEV_JWT_SECRET`, and the browser stores it under `aseb.access-token`. Without
  `VITE_SUPABASE_*` the sign-in page falls back to this strategy and says so in the UI.
- When `AUTH_DEV_MODE=true` _and_ `SUPABASE_URL` is set, the dev strategy is tried first and a token
  it cannot verify falls through to JWKS verification. One API process can therefore serve both
  while a developer migrates. Production has `isDevMode === false`, so only the Supabase branch is
  reachable there.
- The strategies are never mixed: `AuthProvider` picks one from the presence of `VITE_SUPABASE_*`,
  so a stale `aseb.access-token` cannot sign anyone in once Supabase is configured.
- `apps/web/vite.config.ts` sets `envDir` to the repository root, so the single root `.env` feeds
  both workspaces and the documented `VITE_*` block actually reaches the browser. Only
  `VITE_`-prefixed keys are inlined into the bundle; the server-side secrets in the same file stay
  server-side.

---

## 7. Verified state (commands actually executed)

| Command                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                                                                                           | PASS — 0 errors, 0 warnings (re-run for Phase 8)                                                                                                                                                                                                                                                                                                                                                              |
| `npm run typecheck`                                                                                                      | PASS — shared, api (src + tests), web (re-run for Phase 8)                                                                                                                                                                                                                                                                                                                                                    |
| `npm run build`                                                                                                          | PASS — shared, api (tsc), web (vite, 447.74 kB js / 12.42 kB css) (re-run for Phase 8)                                                                                                                                                                                                                                                                                                                        |
| `npx vitest run apps/web/src apps/api/tests/{prompt-builder,enhance-prompt,cv-templates,database-schema}.test.ts`        | PASS — 9 files, **50 tests** (Phase 8; the only suites that run without binding a socket)                                                                                                                                                                                                                                                                                                                     |
| `npx vitest run apps/api/tests/payment-provider.test.ts apps/web/src/pages/CreditsPage.test.tsx`                         | PASS — 33 tests (Phase 9 offline suites: provider boundary + credits UI)                                                                                                                                                                                                                                                                                                                                      |
| `npx vitest run apps/api/tests/{screening-contracts,screening-prompt}.test.ts apps/web/src/pages/CreditsPage.test.tsx`   | PASS — 29 tests (Phase 10 offline suites: screening contracts + HRD_SCREENING_V1 prompt)                                                                                                                                                                                                                                                                                                                      |
| `npm run lint`                                                                                                           | PASS — 0 errors, 0 warnings (re-run for Phase 11)                                                                                                                                                                                                                                                                                                                                                             |
| `npm run typecheck`                                                                                                      | PASS — shared, api (src + tests), web (re-run for Phase 11)                                                                                                                                                                                                                                                                                                                                                   |
| `npm run build`                                                                                                          | PASS — shared, api (tsc), web (vite, 702.86 kB js / 12.63 kB css) (re-run for Phase 11)                                                                                                                                                                                                                                                                                                                       |
| `npx vitest run apps/api/tests/{zip,screening-contracts,screening-prompt}.test.ts`                                       | PASS — 3 files, **37 tests** (Phase 11 offline suites: ZIP hardening + screening contracts)                                                                                                                                                                                                                                                                                                                   |
| `npx vitest run apps/api/tests/screening-batch.test.ts`                                                                  | NOT RUN — 14 tests skipped, suite aborts with `listen EPERM` (socket-bound, see §8.4)                                                                                                                                                                                                                                                                                                                         |
| `npx vitest run apps/web/src`                                                                                            | 16 files: 13 pass / 3 fail, **96 passed / 17 failed** — the 3 failures are pre-existing and unrelated (see §8.15)                                                                                                                                                                                                                                                                                             |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 12; `dist/worker.js` is built)                                                                                                                                                                                                                                                                                                                                                         |
| `npx vitest run apps/api/tests/screening-queue.test.ts`                                                                  | PASS — **12 tests** (Phase 12 offline suite: driver choice, retry/backoff/concurrency/idle, outcome rule, processor seam)                                                                                                                                                                                                                                                                                     |
| `node apps/api/dist/worker.js` (no `REDIS_URL`)                                                                          | PASS — logs the warning that the API process runs the worker in-process, exits 0                                                                                                                                                                                                                                                                                                                              |
| `npx vitest run apps/api/tests/{screening-queue-flow,screening-batch,screening-api}.test.ts`                             | NOT RUN — 41 tests skipped, every suite aborts with `listen EPERM` (socket-bound, see §8.4)                                                                                                                                                                                                                                                                                                                   |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 13)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/api/tests/{evidence-extraction-prompt,screening-evidence,screening-queue,screening-prompt}.test.ts` | PASS — 4 files, **39 tests** (Phase 13: extraction prompt + grounding/service + queue)                                                                                                                                                                                                                                                                                                                        |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 14)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/api/tests/scoring-engine.test.ts`                                                                   | PASS — **14 tests** (Phase 14: the deterministic rule set, offline)                                                                                                                                                                                                                                                                                                                                           |
| `npx vitest run apps/api/tests/screening-queue-flow.test.ts`                                                             | NOT RUN — 10 tests skipped, suite aborts with `listen EPERM` (socket-bound, see §8.4)                                                                                                                                                                                                                                                                                                                         |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 15)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/api/tests/screening-report-template.test.ts`                                                        | PASS — **9 tests** (Phase 15: escaping, CSV shape, file names, payload contract)                                                                                                                                                                                                                                                                                                                              |
| `npx vitest run apps/web/src/pages/{ScreeningPage,ScreeningJobPage}.test.tsx`                                            | PASS — **9 tests** (Phase 15: ranked results, unmet hard requirement, unscored candidate, upload form, create-job draft)                                                                                                                                                                                                                                                                                      |
| `npx vitest run apps/api/tests/screening-results-api.test.ts`                                                            | NOT RUN — 7 tests skipped, suite aborts with `listen EPERM` (socket-bound, see §8.4)                                                                                                                                                                                                                                                                                                                          |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 16)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/api/tests/{http-guards,portfolio-prompt,portfolio-verification}.test.ts`                            | PASS — 3 files, **26 tests** (Phase 16: SSRF guards, the verification prompt, the service with injected doubles)                                                                                                                                                                                                                                                                                              |
| `npx vitest run apps/web/src/pages/ScreeningJobPage.test.tsx`                                                            | PASS — **6 tests** (Phase 15 cases plus verified-evidence rendering and the verify action)                                                                                                                                                                                                                                                                                                                    |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 17)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/web/src/pages/TestimonialsPage.test.tsx`                                                            | PASS — **4 tests** (Phase 17: public list, empty state, form validation, submit tied to the enhancement)                                                                                                                                                                                                                                                                                                      |
| `npx vitest run apps/api/tests/testimonials-api.test.ts`                                                                 | NOT RUN — 5 tests skipped, suite aborts with `listen EPERM` (socket-bound, see §8.4)                                                                                                                                                                                                                                                                                                                          |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 18)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/web/src/pages/AdminPage.test.tsx`                                                                   | PASS — **4 tests** (Phase 18: non-admin gate, aggregates, price override, testimonial moderation)                                                                                                                                                                                                                                                                                                             |
| `npx vitest run apps/api/tests/admin-api.test.ts`                                                                        | NOT RUN — 5 tests skipped, suite aborts with `listen EPERM` (socket-bound, see §8.4)                                                                                                                                                                                                                                                                                                                          |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 19)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/api/tests/rate-limit.test.ts`                                                                       | PASS — **9 tests** (Phase 19: window semantics, 429 + retry-after, per-user keys, fail-open, store selection, client fingerprint)                                                                                                                                                                                                                                                                             |
| `npm run lint` / `npm run typecheck` / `npm run build`                                                                   | PASS (re-run for Phase 20)                                                                                                                                                                                                                                                                                                                                                                                    |
| `npx vitest run apps/web/src`                                                                                            | **PASS — 13 files, 67 tests** (the three suites that had been red since Phase 11 are fixed; see §8.15)                                                                                                                                                                                                                                                                                                        |
| `npx vitest run apps/api/tests/{provider-behaviour,shared-weights}.test.ts`                                              | PASS — 2 files, **15 tests** (Phase 20: provider failure modes + result shapes, shared weight helpers)                                                                                                                                                                                                                                                                                                        |
| `npx vitest run --coverage <offline suites + apps/web/src>`                                                              | 60.14% statements / 59.27% lines repo-wide **for that subset only** — the socket-bound suites were not run (§8.4)                                                                                                                                                                                                                                                                                             |
| `npm run test:e2e`                                                                                                       | NOT RUN — Chromium is not installed here; the specs are written (§8.45)                                                                                                                                                                                                                                                                                                                                       |
| Compose/Dockerfile structural check (`yaml` parse + path/script existence)                                               | PASS — 6 services (db, redis, migrate, api, worker, web) with the intended healthchecks and dependency graph; every `COPY` source and every referenced npm script resolves (§8.46)                                                                                                                                                                                                                            |
| `docker compose up --build`                                                                                              | NOT RUN — no Docker daemon in the agent environment (§8.46)                                                                                                                                                                                                                                                                                                                                                   |
| `.gitlab-ci.yml` structural check (`yaml` parse: jobs, stages, services, `extends`)                                      | PASS — 6 jobs over 5 stages (quality/test/build/e2e/images), `e2e` carries the Postgres service, `images` the DinD service; every referenced npm script exists (§8.48)                                                                                                                                                                                                                                        |
| `npx playwright test --list --config apps/web/playwright.config.ts`                                                      | PASS — the config loads (including the new `webServer` entries) and lists 4 tests in 3 files; running them still needs Chromium (§8.45)                                                                                                                                                                                                                                                                       |
| `gitlab-ci` pipeline run                                                                                                 | NOT RUN — no GitLab runner here (§8.48)                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run test` on the owner's Mac (2026-09-26)                                                                           | 54 files: **48 pass / 6 fail**, 477 tests: 464 pass / **13 fail** — all real, none socket-related (see §8.51-53)                                                                                                                                                                                                                                                                                              |
| Fixed 13 → 6 (owner's second run)                                                                                        | PASS — testimonials (3), admin-api (1), screening-api cancel (1), screening-results fixture (2 of 5) went green                                                                                                                                                                                                                                                                                               |
| Fixed 6 → 0 (this round, verification pending on the owner's machine)                                                    | runner scoring (§8.52) + multipart options (§8.53) + the CSV label assertion                                                                                                                                                                                                                                                                                                                                  |
| `npx vitest run tests/{enhance-upload-options,screening-runner-scoring}.test.ts`                                         | PASS — **6 tests** (new regression tests; both mutation-checked against the reintroduced bug)                                                                                                                                                                                                                                                                                                                 |
| `npx playwright install chromium && npm run test:e2e` (owner's Mac, 2026-09-26)                                          | FAIL — `Timed out waiting 120000ms from config.webServer` although both servers started; root cause and fix in §8.54 (port-based readiness + offline providers pinned). Chromium installed.                                                                                                                                                                                                                   |
| `npm run test:e2e` (owner's Mac, 2026-09-26, second run)                                                                 | **1 passed / 3 failed** — the guest-audit spec passed end to end; both screening specs timed out on the create form and the landing spec hit a duplicate-text matcher. Causes and fixes in §8.55 (browser auth strategy leak + `.env.e2e`/`--mode e2e`, `--strictPort`, no server reuse, `exact: true`).                                                                                                      |
| `npm run test:e2e` (owner's Mac, 2026-09-26, third run, local Postgres)                                                  | **2 passed / 2 failed** — landing and audit green (and the API ran with `aiProvider: mock`, browser in `e2e` mode); the screening specs aborted their own sign-up request (§8.58). Fixed with the API-created session helper + a dedicated signin spec; five specs total, re-run pending.                                                                                                                     |
| `npm run test:e2e` (owner's Mac, 2026-09-26, local Postgres)                                                             | **PASS — 5 passed (5.6s)**: landing, guest audit, development sign-in, and both screening flows (job → batch upload → ranked evidence → CSV download; an evidence-less candidate kept visible with score 0). Uploads need credits, so the suite also covers checkout → simulate → the idempotent webhook path (§8.59).                                                                                        |
| **Owner-verified run on macOS (2026-09-26, after both fix rounds)**                                                      | **PASS — 58 files, 490 tests, 0 failed** (web 67 + api 423). The 13 failures are gone; no test was deleted or skipped to get there.                                                                                                                                                                                                                                                                           |
| `npm run test:coverage` (same run)                                                                                       | **PASS** — 83.02% statements / 70.97% branches / 81.48% functions / 84.04% lines. Lowest by design: `deepseek.provider` 2.4%, `puppeteer.provider` 5.6%, `bullmq.queue` 3.3% (only the offline doubles are exercised), `packages/shared/src/index.ts` 0% (re-export barrel). Thin spots worth a look later: `config/env.ts` 52%, `utils/text.ts` 32%, `web/lib/screening.ts` 60%, `web/ScreeningJobPage` 64%. |
| `npm run verify:docs`                                                                                                    | PASS — 57 routes, 54 env keys, 6 prompt versions, no missing or orphan document (the CI `docs` job runs it)                                                                                                                                                                                                                                                                                                   |
| `npm test` (full suite, auth repair)                                                                                     | 32 files: **17 pass / 15 fail**, 128 passed / 154 skipped / 10 failed. Every failure is a socket-bound PGlite or SuperTest suite the sandbox cannot boot (`listen EPERM`) — see §8.4.                                                                                                                                                                                                                         |

Auth repair additions (all executed; none need a socket):

- `npm run lint` / `npm run typecheck` / `npm run build` — PASS. Web build: app chunk 701.96 kB
  (203.12 kB gzip) + a code-split Supabase SDK chunk of 219.00 kB (56.55 kB gzip) that is fetched at
  startup only when `VITE_SUPABASE_*` is configured.
- `apps/web/src/lib/auth.test.tsx` (7, **executed**) — session restored on startup and its token sent
  as `Authorization: Bearer`, token resync on `TOKEN_REFRESHED`, email/password sign-in through
  Supabase, translated provider errors, sign-out clearing both the SDK session and the API token,
  a 401 discarding the session, and the dev-token fallback when Supabase is not configured.
- `apps/web/src/pages/SignInPage.test.tsx` (7, **executed**) — Google OAuth started with
  `redirectTo: <origin>/profile`, OAuth loading state, Supabase email/password sign-in landing on
  `/profile`, sign-up with the confirmation-email notice, shared-schema validation before any
  provider call, the provider error left behind by a failed redirect, and the offline dev-mode
  explanation with the Google button disabled.
- `apps/web/src/components/ProtectedRoute.test.tsx` (3, **executed**) — session-restore loading state
  (no premature redirect), signed-out redirect, and rendering once the session is restored.
- `apps/api/tests/jwt-supabase-token.test.ts` (7, **executed**) — real `jose` verification against a
  locally generated ES256 key pair with a stubbed JWKS: Google sign-in, a linked Google identity
  where `provider` stays `email` but `providers` contains `google`, unconfirmed password sessions,
  wrong audience and wrong signing key rejection.
- `apps/api/tests/auth-identity-flags.test.ts` (5, **executed**) — the additive account-flag rule in
  `mergeAuthFlags`: linking Google keeps `hasPassword`, a later password sign-in keeps
  `googleConnected`, and a confirmed email is never un-verified.
  | API boot + curl | Phase 6: `GET /api/health` 200, `GET /api/cv/test` 200, unknown route 404 envelope, wallet without token 401 (not re-run). |

Phase 13 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/evidence-extraction-prompt.test.ts` (6, **executed**) — `HRD_EVIDENCE_EXTRACTION_V1`
  is registered and distinct from the job-level `HRD_SCREENING_V1`, temperature stays at 0.05, the
  system role carries the global rules + "TIDAK menghitung skor" + the status vocabulary, the
  frozen preference/scoring context and the requirement ids travel as labelled JSON (exactly one
  verdict per requirement), the CV is the last delimited document, and injection text in the CV or
  job description never reaches the system role and stays inside its delimiter.
- `apps/api/tests/screening-evidence.test.ts` (13, **executed**) — grounding keeps a real quote and
  clears the unverifiable page number, downgrades `FOUND` to `UNCERTAIN` when nothing verifies and
  drops the quote, never upgrades `NOT_FOUND`, keeps only verifiable quotes for `UNCERTAIN`, and
  treats a quote from a source it does not hold as unverifiable. The service (provider, preference
  snapshot and usage recorder injected) returns the versioned envelope, grounds before storing,
  sends the extraction prompt with the frozen version, records usage against
  `HRD_SCREEN_PER_CV` + job + candidate, refuses to run without stored CV text, falls back to the
  file-derived label when the model returns no name, and round-trips the composed prompt through
  the **real** `MockAIProvider` (prompt → provider → Zod → grounding → envelope).
- `apps/api/tests/screening-queue-flow.test.ts` (8, **written but not executed here**) — the Phase 12
  cases plus: the runtime default processor extracts evidence (COMPLETED, envelope with
  `HRD_EVIDENCE_EXTRACTION_V1`, `FOUND` criterion with a verified quote, one `AiUsageRecord` linked
  to the candidate, credits charged) and a provider outage fails the candidate after the configured
  attempts with a full refund. The Phase 12 "processor is unavailable" case is gone, because the
  real processor replaced that placeholder.

Phase 23 additions:

- `scripts/verify-docs.mjs` + `npm run verify:docs` + the CI `docs` job - the documentation drift
  guard described above (routes, env keys, prompt versions, cross-references, orphan documents).
- `docs/DEPLOYMENT.md` - the deploy runbook: prerequisites, database/pooler details, Option A (the
  container stack) and Option B (managed pieces), the environment table per environment, the
  post-deploy smoke test, the launch limits and rollback.
- `README.md` + `PROJECT_CONTEXT.md` - point at the runbook; the "all five documents" phrasing is now
  six.

Phase 22 additions:

- `.gitlab-ci.yml` - `quality` (lint, typecheck), `test` (Vitest + production builds), `e2e`
  (Playwright against the real API, a Postgres service and mock providers) and `images`
  (`docker build`, push only from a tag), with `npm ci` (scripts enabled) and a lockfile-keyed cache.
- `apps/web/playwright.config.ts` - `webServer` entries for the API and the web dev server, so the
  browser suite is self-contained in CI and reuses a developer's servers locally.
- `apps/api/Dockerfile` + `apps/web/Dockerfile` - install with scripts enabled (the
  `@prisma/engines` postinstall is required) and disable Chromium/husky explicitly (§8.49).
- `apps/api/tests/helpers/db.ts`, `README.md`, `docs/DATABASE.md` - the `TEST_DATABASE_URL` claim
  corrected to "PGlite only" (§8.47).

Phase 21 additions:

- `apps/api/Dockerfile` (targets `deps` / `build` / `migrate` / `runtime`), `apps/web/Dockerfile`
  (Vite build -> nginx), `apps/web/nginx.conf` (SPA fallback, `/api` proxy, asset caching, security
  headers, 70 MB upload ceiling), `docker-compose.yml` (db, redis, migrate, api, worker, web) and
  `.dockerignore`.
- Verified here (no Docker daemon): the compose file parses and contains exactly the six intended
  services with their healthchecks and `service_completed_successfully` gating; every path the
  Dockerfiles copy and every npm script they invoke exists; `.dockerignore` keeps `.env*`,
  `node_modules`, build output and `legacy/` out of the build context.
- Not verified here: an actual image build or `compose up` (§8.46).

Phase 20 additions (executed where the sandbox allowed it; see the note below):

- `apps/web/src` (13 files, **67 tests, all executed**) — the web workspace is green for the first
  time since Phase 11, because the vitest config now pins the Supabase browser variables to empty
  (see §8.15). Nothing about the pages changed; the environment did.
- `apps/api/tests/provider-behaviour.test.ts` (8, **executed**) — an outage, a 429 and unparseable
  model output arrive as distinct typed errors and the outage behaviour is a countdown rather than
  a latch; the audit, enhancement, screening and portfolio results all validate against their
  shared schemas and carry their own prompt version id; an unreadable portfolio page is reported
  as inconclusive instead of being summarised.
- `apps/api/tests/shared-weights.test.ts` (7, **executed**) — the two exported shared weight
  helpers: empty/absent configurations are valid, a complete configuration totalling 100 is valid,
  a wrong total is reported (never silently renormalised), unknown/negative/non-numeric entries
  are reported, shares sum to one, and degenerate input falls back to uniform shares.
- `apps/api/tests/screening-evidence.test.ts` (14, **executed**) — gained a case proving an invalid
  provider response propagates, stores no envelope and writes no provider-cost row.
- `apps/web/e2e/{audit,screening}.spec.ts` + `e2e/helpers/pdf.ts` (**written, not executed**) —
  the guest audit flow and the recruiter flow (dev sign-up -> create job -> upload a CV -> ranked
  result with evidence -> CSV download), plus the case where an unmet hard requirement keeps the
  candidate visible.

Phase 19 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/rate-limit.test.ts` (9, **executed**) — pure and offline: the in-memory store
  counts inside a window and starts over after it (with an injected clock), keys stay independent
  and `reset()` clears, the middleware allows exactly `max` requests and then answers a typed 429
  with `retry-after` and the `x-ratelimit-*` headers, a caller-supplied key isolates per-account
  caps (the testimonial case), an unreachable store fails open instead of breaking the request,
  the factory picks memory without `REDIS_URL` and Redis with it, and the client fingerprint
  prefers the first forwarded address. The testimonial POST route is also asserted to carry the
  limiter in front of its validation.

Phase 18 additions (executed where the sandbox allowed it; see the note below):

- `apps/web/src/pages/AdminPage.test.tsx` (4, **executed**) — a non-admin sees the gate and no
  admin request is even attempted, an admin sees the aggregate tiles (users, testimonials,
  system state) plus the failed-candidate reason, saving a new credit price sends exactly
  `{ credits }` to `/api/admin/pricing/CV_ENHANCEMENT`, and approving a pending testimonial
  PATCHes its moderation endpoint.
- `apps/api/tests/admin-api.test.ts` (5, **written but not executed here**) — all eleven admin
  routes answer 401 anonymously and 403 for a normal user, the dashboard payload parses against
  the shared `adminOverviewSchema`, a price override comes back as `isOverride` **and** changes
  what the public `/api/credits/pricing` reports (recording `updatedByUserId`), an unknown
  feature and an out-of-range price are 400, a credit adjustment writes an `ADJUSTMENT` ledger
  row through the credit service and moves the balance (zero is 400), a self-demotion is 409 and
  an unknown role is 400, and every reporting list answers with its documented key, its wallet
  balance, and no credential material.

Phase 17 additions (executed where the sandbox allowed it; see the note below):

- `apps/web/src/pages/TestimonialsPage.test.tsx` (4, **executed**) — the public list renders the
  approved review with its rating and hides nothing about the author's chosen name, the empty
  state invites the first review, the form refuses a comment shorter than the contract allows
  without sending a request, and a valid submission posts `rating` + `comment` +
  `enhancementId` and then reports that the review waits for moderation.
- `apps/api/tests/testimonials-api.test.ts` (5, **written but not executed here**) — a review
  needs a session and stays private (`PENDING`) until approved, the author's fallback display
  name is the profile name and never the email, the public list carries only `APPROVED` reviews
  and never exposes the moderation status, moderation is 401/403 without an admin (and the
  admin queue works once promoted), the payload and the moderation vocabulary are validated,
  and a review tied to an enhancement must target the author's own `COMPLETED` enhancement,
  exactly once.

Phase 16 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/http-guards.test.ts` (13, **executed**) — pure and offline, no socket opened:
  loopback / private / link-local / CGNAT / cloud-metadata / multicast / reserved IPv4 and the
  IPv6 equivalents are refused, IPv4-mapped addresses are judged by the IPv4 rules, a non-IP
  string is treated as untrustworthy, `file:`/`javascript:`/non-URLs and internal hostnames are
  refused while public http(s) URLs pass, GitHub/LinkedIn/portfolio hosts are classified, the
  content-type allowlist rejects PDFs and images, markup/scripts/entities are stripped before
  anything reaches a prompt, and the guarded provider refuses a public-looking hostname that
  resolves into a private range (plus a host that does not resolve).
- `apps/api/tests/portfolio-verification.test.ts` (9, **executed**) — the service with the
  fetcher, AI provider, credit service, usage recorder and repository all injected: links are
  found/cleaned/deduplicated/capped, a fetched page becomes `SUPPORTED` with a stored evidence
  row and exactly one hold settled for one unit, LinkedIn is recorded but never fetched, a
  failing fetch and an unreadable page both release the whole hold and store no evidence, a
  fresh snapshot is reused without fetching (only the uncached link is fetched), a CV without
  links stays `NOT_CHECKED` and spends nothing, the feature can be switched off, and a
  candidate from another user/job is a 404.
- `apps/api/tests/portfolio-prompt.test.ts` (4, **executed**) — the verification prompt's
  version, layers, URL-as-labelled-data, page-as-last-delimited-document and injection
  containment.

Phase 15 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/screening-report-template.test.ts` (9, **executed**) — pure and offline: the
  HTML report carries the job, the methodology note, the rank and the evidence; candidate
  names, summaries, criteria and quotes are escaped so a CV cannot inject markup; an unscored
  or unmet candidate is labelled (`belum dinilai`, `REQUIREMENT_NOT_MET`, the unmet-requirement
  note) instead of hidden; an empty batch says so; the CSV emits one row per evidence item with
  the documented columns, keeps a criterion that has no evidence (so the gap is visible),
  lists a candidate with no scored criteria, round-trips commas/quotes/newlines through
  `csv-stringify`, and the file name is safe for both formats.
- `apps/web/src/pages/ScreeningJobPage.test.tsx` (5, **executed**) and
  `apps/web/src/pages/ScreeningPage.test.tsx` (4, **executed**) — the recruiter UI: ranked
  results with the deterministic score and the evidence panel, an unmet hard requirement kept
  visible with its explicit note, `belum dinilai` instead of a zero for an unscored candidate,
  the upload form while a batch is empty, a failed results request surfacing as an alert, the
  job list with its progress counts, the first-session empty state, the draft form's client-side
  validation (no request is sent), and the POST body the create form actually sends.
- `apps/api/tests/screening-results-api.test.ts` (7, **written but not executed here**) —
  401/404 scoping on all three routes, ranked results with per-criterion evidence and the frozen
  versions, `REQUIREMENT_NOT_MET` with the candidate still present, CSV generation (bytes,
  hash, `GeneratedReport` row, metadata-only list), PDF generation through the offline renderer,
  an unknown format (400) and an empty batch (409), and the envelope contract scoring depends on.

Phase 14 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/scoring-engine.test.ts` (14, **executed**) — pure and offline: equal shares with
  no category weights and full/zero scores for fully supported/unsupported candidates, category
  weights redistributing influence, half credit for `UNCERTAIN`, the confidence rule downgrading a
  weak `FOUND` (and never upgrading), `FOUND` without a stored quote losing credit, a missing
  verdict treated as absent evidence, an unmet hard requirement producing `REQUIREMENT_NOT_MET`
  while the candidate stays scored, the 75/55/54 eligibility boundaries, strengths/gaps/
  uncertainties derived from outcomes, stored weights summing to one and reproducing the score
  within `Decimal(6,5)`/`Decimal(5,2)` precision, determinism including evidence order, and
  degenerate input (no requirements, zero weights) scoring zero instead of crashing.
- `apps/api/tests/screening-queue-flow.test.ts` (10, **written but not executed here**) — adds the
  end-to-end scoring case (one `FOUND` criterion, score 100 / `HIGH_MATCH`, one criterion row and
  one evidence row, re-scoring replacing rather than duplicating them) and the unscored case
  (a processor that stores no envelope leaves `score`/`eligibility_status` NULL).

Phase 12 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/screening-queue.test.ts` (12, **executed**) — pure and offline: the driver
  selection rule only picks BullMQ when `REDIS_URL` is set, the in-process driver runs every
  candidate and honours the concurrency cap, jobs stay pending until a handler is attached,
  retries follow exponential backoff and stop on the final attempt, a successful retry ends
  the loop, `stop()` cannot hang `waitForIdle`, the batch-outcome rule waits while anything is
  queued/running and distinguishes complete/partial/failed (and reports nothing for an empty
  batch), and the processor seam swaps in a stub while the default refuses to run with the
  documented message.
- `apps/api/tests/screening-queue-flow.test.ts` (7, **written but not executed here**) — upload
  → drain with a stub processor: a batch reaches `COMPLETED`, settles
  `unitPrice x completed` and releases the hold; a transient failure retries and then
  succeeds with `attempts: 2`; one failing candidate yields `PARTIALLY_COMPLETED` and charges
  only the successes (with retry/failure/completion events); an always-failing processor
  yields `FAILED` with zero charged and the full hold released; the _unavailable_ processor
  cannot mark anyone complete while leaving the wallet untouched; a redelivered candidate is
  a no-op (same state, same credits, no new events); and cancelling a queued batch fails its
  candidates, settles at zero and frees the hold.

Phase 11 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/zip.test.ts` (10, **executed**) — archive guards, all offline: entry order and
  name sanitisation, directories and `__MACOSX`/`._`/`.DS_Store` metadata ignored, non-PDF entries
  reported as `rejected` without failing the batch, too-many-entries / total-uncompressed-size /
  compression-ratio (zip bomb) / non-ZIP / truncated-archive rejections with the right error code,
  one oversized entry rejected per file, and the max-PDF-count ceiling.
- `apps/api/tests/screening-contracts.test.ts` (18 total, **executed**) — the Phase 10 cases plus
  the batch block: a partial-success payload parses, the candidate wire format carries no `cvText`
  or `textHash`, an unknown rejection code and negative counters are rejected, an unknown candidate
  state is rejected, and `candidateNameFromFileName` derives a neutral label from the file name
  only (`Kandidat` when there is nothing to derive).
- `apps/api/tests/screening-batch.test.ts` (14, **written but not executed here**) — 401 anonymous,
  404 for another user's job, 400 with no files, the happy path (2 CVs stored `QUEUED`, text +
  hash + page count, job counters, `CANDIDATE_QUEUED`/`STATE_CHANGED` events, `ACTIVE` reservation
  linked to the job), per-file partial success without charging the rejected file, a ZIP batch with
  a non-PDF entry, a scanned PDF (400 when nothing survives), mixed ZIP + PDF rejection, a zip bomb
  through the API (415, nothing written), 402 for an unaffordable batch with the job left `CREATED`,
  409 on a second batch, deterministic pagination of the candidate list, a cross-user 404, and the
  50-file ceiling.

Phase 10 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/screening-contracts.test.ts` (12, **executed**) — the service defaults equal the
  shared `DEFAULT_RECRUITER_PREFERENCES` (drift guard), preference list caps, the all-or-nothing
  six-category weight rule (a partial map is rejected, total must be exactly 100), requirement
  defaults, the 1-40 requirement bounds, weight bounds, title/description minimums and the
  cancel-only state update.
- `apps/api/tests/screening-prompt.test.ts` (9, **executed**) — `HRD_SCREENING_V1` version id and
  low temperature, global policy + the "model never scores" rule in the system role, labelled
  `[KONTEKS: ...]`/`[TUGAS: ...]` JSON blocks, the frozen preference version and scoring
  configuration, empty preference lists dropped while `portfolioImportance` is kept, document
  ordering (job description → CV → external evidence) with everything delimited last, and injection
  text staying inside the untrusted delimiter and out of the system role.
- `apps/api/tests/screening-api.test.ts` (20, **written but not executed here**) — auth on every
  route, defaults at version 0 without writing rows, versioned saves with immutable snapshots
  (newest first) and schema defaults, the preference-list cap, job creation with frozen versions
  and no credits reserved, requirement defaults and ordering, inherited vs overridden
  weights/notes, the `useRecruiterPreferences: false` opt-out, `STATE_CHANGED` events, all
  validation failures, owner scoping for read/list/progress/cancel, single-use cancellation and
  zeroed progress.

Phase 9 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/payment-provider.test.ts` (25, **executed**) — the mock provider's
  deterministic attempt and HMAC verification (missing/tampered/wrong-secret signatures all
  refused), the Midtrans `sha512(order_id + status_code + gross_amount + server_key)` vector,
  forged and amount-tampered notifications refused, the missing-server-key guard, and the full
  Midtrans status table (`capture`/`challenge` stays unsettled, `capture`/`deny` fails,
  `expire`/`refund`/`chargeback` map to their terminal states). Runs entirely offline.
- `apps/api/tests/payments-api.test.ts` (26, **written but not executed here**) — auth on
  checkout, both/neither package-vs-credits validation, unknown package, below-minimum custom
  amount, PENDING row with no credits granted, invalid signature (403, no event, no credits),
  verified settlement with the `TOP_UP` ledger row, replay as a `DUPLICATE` no-op, amount
  mismatch, unknown order, `PENDING` notification, expiry, late-failure-after-completion,
  refund without credit reversal, overdue sweep, settlement after local expiry, retry of a recorded
  but unprocessed delivery, completion of a claimed-but-ungranted payment, owner scoping for
  read/simulate/list, and the Midtrans callback being hidden while the mock provider is active.
- `apps/web/src/pages/CreditsPage.test.tsx` (8, **executed**) — the Phase 5 cases plus
  top-up start (POST body + pending panel with order id and QR payload), offline simulation
  through the webhook path, and the top-up history list.

Phase 8 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/cv-templates.test.ts` (8, **executed**) — all three template keys render, strict
  CSP with no script/anchor/`src=` surface, untrusted CV text escaped (XSS attempt stays inert),
  empty sections omitted, safe download names, the plain-text rendition, and the mock renderer's
  determinism plus per-template fingerprint change.
- `apps/api/tests/cv-export.test.ts` (8, **written but not executed here**) — 401 anonymous, 404 for
  another user's enhancement, 402 with no render for an unaffordable user, reserve → settle with
  the generated `ENHANCED` document + `resultDocumentId` + ledger row, template switch changing the
  rendered HTML, renderer failure → 503 + reservation `RELEASED` + unchanged balance, 409 for a
  non-completed enhancement, and 400 for an unknown template key.
- `apps/web/src/pages/EnhancePage.test.tsx` (6, **executed**) — the Phase 7 cases plus the export
  case (price label, POST body, download triggered through `URL.createObjectURL`).

Phase 7 additions (executed where the sandbox allowed it; see the note below):

- `apps/api/tests/enhance-prompt.test.ts` (5) — payload version and temperature, the consent gate
  (a saved profile never reaches context or system prompt without `useProfileContext`), labelled
  JSON context, request links as explicit consent, and CV/notes as the last delimited documents
  with injection text contained inside the block.
- `apps/api/tests/cv-enhancement.test.ts` (8, **written but not executed here**) — 401 for
  anonymous requests, 402 with no rows for an unaffordable user, reserve → settle with the ledger
  entry, `JOB_SEEKER_ENHANCE_V1` on the row/usage, provider failure → `FAILED` + reservation
  `RELEASED` + balance restored, scanned PDF → release, malformed `options` → 400, consent flag
  round-trip, history/detail reads and cross-user 404.
- `apps/web/src/pages/EnhancePage.test.tsx` (5) — signed-out prompt, upload + Before vs After
  rendering, options JSON (including the consent flag), client-side non-PDF rejection and the
  insufficient-credits link.
- `apps/api/tests/database-schema.test.ts` (7) — re-run to prove the folded `prompt_version` column
  still matches `prisma migrate diff --from-empty`.

Phase 6 additions (all re-verified after the final edit, not just at the time of writing):

- `tests/cv-audit.test.ts` (11) — guest audit is 0 credits, versioned and leaves no CV rows;
  signed-in audit stores document + analysis + usage with `JOB_SEEKER_AUDIT_V1`; history/detail
  reads and cross-user isolation; non-PDF, misleading extension, empty buffer, oversized (413),
  scanned PDF (422), provider failure (502) and rate-limit (503) mapping; guest IP throttle (429);
  the guest response validates against `cvAuditResponseSchema`.
- `tests/prompt-builder.test.ts` (7) — layer order (policy → feature → context → task → untrusted
  last), document content never reaching the system role, injection text staying inside the
  delimiter, per-document bounds, version ids, label sanitisation and `composeSystemPrompt`.
- `apps/web/src/pages/AuditPage.test.tsx` (5) — guest form with no account, PDF upload and
  structured result rendering, client-side non-PDF rejection, API error surfacing, stored-result
  copy for a signed-in user.

Phase 5 additions:

- `tests/credits-api.test.ts` (13) — public price list and packages, admin override visibility,
  wallet auth requirement and exact field set, empty and paginated ledger pages, out-of-range
  pagination rejection, a top-up appearing as a `TOP_UP` ledger entry, cost estimates for a paid and
  a free feature, unknown feature rejection, and estimate auth.
- `apps/web/src/pages/CreditsPage.test.tsx` (5) — public price list and packages for a signed-out
  visitor with no wallet request, signed-in balance and ledger, paging the ledger, the empty-ledger
  state, and a failed wallet request surfacing an error instead of a stale balance.

Phase 4 additions:

- `tests/auth.test.ts` (11) — dev sign-up/sign-in, duplicate email, unknown-email and wrong-password
  parity, single identity row per account, `/api/auth/me`, wallet bootstrap, malformed/forged token
  rejection, no credential leakage, `AUTH_DEV_MODE=false` refusal, `ADMIN_EMAILS` bootstrap.
- `tests/profile.test.ts` (12) — auth required, exact profile shape, field updates, clearing with
  `null` and `''`, partial updates, invalid URL and empty payload rejection, refusal to change
  email/role, cross-user isolation, Google link state with and without Supabase, 503 and 409 on the
  connect preflight.
- `tests/admin-authorization.test.ts` (5) — anonymous 401, normal user 403, token claim ignored in
  favour of the stored role, and access revoked for a demoted admin holding a valid ADMIN token.
- `apps/web/src/App.test.tsx` (2) and `apps/web/src/pages/ProfilePage.test.tsx` (5) — landing shell,
  signed-out redirect, profile load/save/clear, API error surfacing, Google unavailable and
  already-connected states.

Test coverage detail:

- `tests/prompt-builder.test.ts` (7) and `tests/cv-audit.test.ts` (11) — see the Phase 6 block above.
- `tests/db-harness.test.ts` (5) — real migration SQL applied to PGlite, Prisma CRUD, unique
  constraints, transaction rollback, enum round-trip.
- `tests/credit-ledger.test.ts` (16) — top-up, ledger traceability, idempotent payment reference,
  reservation holds, affordability rejection, partial settlement, overcharge clamping, double-settle
  idempotency, release, concurrent overspend guard, negative-balance guard, refunds, `balanceAfter`
  consistency, cost estimates, admin pricing overrides, typed 402 error.
- `tests/app.test.ts` (10) — health, legacy route, error envelope, request id echo, auth-required,
  validation errors, CORS allowlist.
- `tests/database-schema.test.ts` (7) — `prisma migrate diff` parity with the committed migration,
  table/enum/primary-key parity, unique-index and cascade guards.
- `tests/migrate-deploy.test.ts` (3) — the real `prisma migrate deploy` CLI applied against a
  PostgreSQL-wire server, `_prisma_migrations` history row, resulting table count.
- `tests/cv-repository.test.ts` (9) — document create/read, newest-original selection, soft delete,
  owner-scoped deletion, analysis pagination and JSON round-trip, enhancement lifecycle, cascade delete.
- `tests/pricing-repository.test.ts` (7) — default fallback, override persistence, upsert semantics,
  cache invalidation, guard rails, batch totals.
- `apps/web/src/App.test.tsx` (2) — shell renders both workflows, signed-out `/profile` redirects.

Not verified here, and why: a live Supabase/PostgreSQL instance (no credentials, sandbox blocks
outbound network — the owner must run `npm run db:deploy` once), Redis/BullMQ (not implemented yet),
DeepSeek live calls (no verified key — the mock provider is exercised instead), Playwright browser
run (Chromium for Playwright not installed), Docker/Compose (not written yet).

**Phase 7–13 sandbox limitation:** every test that boots PGlite (which binds a local TCP port) or
SuperTest (which binds an ephemeral port) fails with `listen EPERM` here, because this environment
forbids all sockets. Phases 7 to 13 therefore verified the API **by typecheck and the offline suites
only**; the integration tests added since (`tests/cv-enhancement.test.ts`, `tests/cv-export.test.ts`,
`tests/payments-api.test.ts`, `tests/screening-api.test.ts`, `tests/screening-batch.test.ts`) plus
`tests/screening-queue-flow.test.ts` and the existing DB suites must be run by the owner with
`npm run test` outside the sandbox (or with `TEST_DATABASE_URL` pointing at a real PostgreSQL
instance). No claim in this document rests on that integration output, and the real
Puppeteer path is unverified.

---

## 8. Known issues and technical debt

1. **Only `docs/DATABASE.md` and `docs/AI_PROMPTS.md` exist** — ARCHITECTURE / API / SECURITY are
   owed by Phases 15, 19 and 23. There is no `docs/API.md` yet, so the `/api/profile` contract lives
   in `packages/shared/src/schemas/profile.ts` and the route/controller comments.
2. **Rate limiting is in-memory** (`src/middleware/rate-limit.ts`) and therefore per-instance. Fine
   for one container. **Resolved in Phase 19**: the store is pluggable and `REDIS_URL` selects a
   Redis-backed one (one Lua script per hit), so replicas share counters. It still fails open if
   the store is unreachable - accepted and documented in `docs/SECURITY.md` §4.
3. **PGlite serialises transactions** (Prisma pool capped at one connection in tests), so concurrency
   tests validate invariants rather than true parallel interleaving.
4. **The integration tests written since Phase 7 are not executed in the agent sandbox** — see §7.
   Run `npm run test` outside the sandbox to exercise `tests/cv-enhancement.test.ts`,
   `tests/cv-export.test.ts`, `tests/payments-api.test.ts`, `tests/screening-api.test.ts`,
   `tests/screening-batch.test.ts`, `tests/screening-queue-flow.test.ts` and the existing DB suites.
5. **`prisma migrate deploy` is verified against a PostgreSQL-wire server, not against live Supabase.**
   The command, migration and config wiring are proven; the remote target is not.
6. **`apps/web` has foundations, not a design system** — router, TanStack Query, an auth context,
   the job-seeker pages (Phases 4-7) and the recruiter pages `/screening` + `/screening/:jobId`
   (Phase 15) exist; the admin screens and a shared component library still arrive with their own
   phases. The production bundle is now **758 kB (213 kB gzipped)** for the app shell (up from
   702 kB before the screening screens) plus a separate 219 kB (57 kB gzipped) Supabase SDK chunk
   requested at startup only when Supabase is configured. Code-splitting the screening and admin
   screens (route-level `lazy`) is the obvious next step before launch.
7. **Google identity _unlinking_ is still missing** and password reset has no UI. Linking itself is
   implemented end to end: the API answers whether linking is allowed and where to return, and the
   browser performs `supabase.auth.linkIdentity` against the authenticated SDK session. Unlinking
   needs the Supabase service-role key, which is why `SUPABASE_SERVICE_ROLE_KEY` is already part of
   the production requirements.
8. **Prisma client is generated into `apps/api/src/generated/`** (git-ignored) and rebuilt by the
   gate scripts; run `npm run gen` after editing `schema.prisma`.
9. **The initial migration was regenerated, not replayed** — nothing has been deployed anywhere, so
   `20260926000000_init` is the single source of truth; the Phase 6 and Phase 7 `prompt_version`
   columns were folded into it rather than added as separate folders, because
   `tests/database-schema.test.ts` asserts the committed migration equals `prisma migrate diff --from-empty`
   (`docs/AI_PROMPTS.md` §8). From the first real deployment onward, migrations must be additive and
   never edited.
10. **Prettier drift** — ~34 files (some written before Phase 3) are not `prettier --check` clean.
    `npm run lint` does not enforce formatting, so the gate stays green. Run `npm run format` once to
    normalise the tree when convenient; Phase 3's own files are clean.
11. **Runtime prompt architecture is layered and versioned for the audit, enhancement and
    screening** — see §11.1 and `docs/AI_PROMPTS.md` §13. `prompts/promptBuilder.ts`,
    `prompts/global/*`, `prompts/jobSeeker/{auditPrompt,enhancePrompt}.ts`,
    `prompts/hrd/evidenceExtractionPrompt.ts` + `hrd/screeningPrompt.ts`, and `promptVersion`
    persistence on `AiUsageRecord` / `CvAnalysis` / `CvEnhancement` / `ScreeningJob` (+ the
    candidate envelope) all exist. Still owed: the portfolio-verification prompt is inline inside
    `providers/ai/deepseek.provider.ts` via the transitional `promptFromParts` (Phase 16) - the
    screening call no longer uses that path.
12. **Top-up is implemented but only exercised offline** — `providers/payments/` (mock + a prepared
    Midtrans Snap adapter), checkout, the signature-verified idempotent webhooks and the dev
    `simulate` endpoint all exist, and `PAYMENT_PROVIDER=mock` settles end to end. **The owner has
    Midtrans sandbox credentials available** (client key + server key), so the first live check is
    an owner-run task: set `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY`, point the notification URL
    at `/api/payments/webhook/midtrans`, `PAYMENT_PROVIDER=midtrans`, then pay one sandbox top-up
    and replay the notification to prove the duplicate is a no-op. Until that run, the adapter
    remains unverified (§8.14-style: no claim here rests on it).
13. **Exported PDFs are stateless** — the bytes are returned in the export response and never
    stored, because there is no storage provider yet (`SUPABASE_STORAGE_ENABLED=false`). The
    `ENHANCED` `CvDocument` keeps metadata, the byte hash and a plain-text rendition, so exports
    are auditable and the text is searchable, but "download it again later" needs Supabase
    Storage (owned by Phase 19/21). The real Puppeteer/Chromium path is also unverified in the
    agent sandbox; only the deterministic mock renderer was executed.
14. **The Supabase auth path is implemented and unit-tested but has never run against a live
    project.** There is no Supabase project, Google OAuth client, browser or reachable Postgres in
    the agent environment. What is verified offline: JWKS verification against a locally generated
    ES256 key pair, the session/token/provider logic through a mocked SDK, the additive account
    flags, and that the SDK stays in its own chunk and is only initialised when `VITE_SUPABASE_*` is
    present. What the owner must still do and observe: create the project, register the Google
    client (`https://<project-ref>.supabase.co/auth/v1/callback`), allowlist
    `<FRONTEND_URL>/profile` as a redirect URL, keep an asymmetric JWT signing key active, set
    `AUTH_DEV_MODE=false`, point `DATABASE_URL`/`DIRECT_URL` at the project, run `npm run db:deploy`,
    then sign in with Google and confirm `/profile` loads and `googleConnected` flips after linking.
15. ~~**Three web page suites fail in the agent sandbox**~~ **Resolved in Phase 20.** The cause was
    environmental, not stale tests: `apps/web/vitest.config.ts` did not pin the Supabase browser
    variables, so Vite loaded the developer's root `.env` and the suite silently ran through the
    Supabase auth strategy (no session -> every dev-token expectation hung). The web vitest config
    now defines `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_BASE_URL` as empty
    strings and tests opt into Supabase explicitly via `configureSupabaseEnv()`. All 13 web suites
    (67 tests) pass.
16. **A screening job holds exactly one batch.** `POST /screening/jobs/:jobId/candidates` returns
    `409` once the job has candidates, so `reservation_id` and `credits_reserved` always describe one
    batch. Adding candidates later needs a second reservation and a settlement rule, so it stays a
    deliberate product decision rather than an accident.
17. **`screening_candidates` has no `sort_order` column.** Every candidate of a batch shares one
    `created_at` (PostgreSQL `now()` is transaction-stable), so `GET .../candidates` pages by
    `(file_name, id)`; the upload response preserves upload order. Add a `sort_order` column only if
    Phase 15's results table needs insertion order.
18. **Rejected-file details are not persisted.** The per-file `rejected` list is returned once, at
    upload time, and is not stored on the job; a recruiter who closes the page loses the reasons.
    Persisting them (a `screening_job_events` payload or a candidate row in a `FAILED` state) is a
    candidate for Phase 15's results/report work.
19. **Until Phase 13 lands, a batch ends `FAILED` with nothing charged.** Phase 12 ships the
    plumbing with an intentionally unavailable processor (`workers/screening.processor.ts`), so a
    real upload is processed, failed and refunded rather than marked screened. That is the honest
    behaviour - nothing may be reported as analysed before the evidence extraction exists - and
    it disappears when Phase 13 supplies the processor. Do not read a `FAILED` batch in this
    window as a candidate outcome.
20. **The BullMQ driver has never run.** There is no Redis in the agent sandbox, so only the
    in-process driver is exercised; `BullMqScreeningQueue` (queue name, `addBulk` options, the
    `attemptsMade`-based attempt count, the polling `waitForIdle`) is typechecked and reviewed but
    unverified. Run it once against a real Redis before relying on it - `REDIS_URL=... npm run
dev:worker` plus one uploaded batch is enough.
21. **Without `REDIS_URL` the AI work runs inside the API process.** That is what keeps local
    development broker-free, but it means a slow provider call competes with HTTP requests and
    cannot be scaled separately. Set `REDIS_URL` and run `npm run dev:worker` (or
    `start:worker`) for anything beyond a single-container MVP.
22. **A settled-at-zero reservation is `SETTLED`, not `RELEASED`.** Cancelling or failing a whole
    batch routes through `CreditService.settle(quantity: 0)`, which releases the hold and records
    `settled_credits = 0`; `credit_reservations.state` alone therefore does not distinguish
    "released" from "settled with nothing charged". Read `settled_credits` (or the ledger) when
    reporting refunds.
23. **Phase 13 shipped without a migration, against §11.1's expectation of a "promptVersion
    persistence migration".** `AiUsageRecord.promptVersion` (already present) links each call to
    its candidate and job, and the candidate's `analysis_json` envelope records the prompt,
    preference, scoring and requirement versions together, so no column was needed.
    A second migration folder is also currently _impossible_ without test work:
    `tests/database-schema.test.ts` compares the concatenated migration SQL against
    `prisma migrate diff --from-empty --to-schema`, which only holds while there is exactly one
    folder (documented in `docs/AI_PROMPTS.md` §8). Before the first real deployment the
    established pattern is folding a column into `20260926000000_init`; after it, the drift test
    must be upgraded to compare per-migration deltas so additive folders are possible.
24. **Evidence page numbers are not stored.** Phase 11 persists the joined CV text without its
    per-page breakdown, so a model-supplied page could not be verified and every stored quote
    carries `page: null` (`grounding.pageVerification = 'unavailable'`). Page-accurate citations
    need the per-page text persisted (a `pages` column or a re-parse of the stored bytes) - a good
    candidate for Phase 15's result view.
25. **Per-criterion result rows are still empty until Phase 14.** `ScreeningCriterionResult`
    requires non-nullable `earned_score` and `normalised_weight`, and only the deterministic engine
    may write a score, so Phase 13 stores the grounded evidence in the candidate envelope and
    leaves those rows to Phase 14. Until then a candidate can be `COMPLETED` with
    `score`/`eligibilityStatus` still `null`.
26. **Evidence extraction has only ever run against the mock provider.** The offline tests exercise
    the real pipeline (composition → provider boundary → Zod → grounding → envelope), but no
    DeepSeek call has been made: there is no verified key in this environment. The first live run
    should check the JSON schema holds for a real CV and that quote grounding is not rejecting
    most quotes.
27. **The scoring rule set is a product decision that wants explicit sign-off.** The engine scores
    `FOUND` 100 / `UNCERTAIN` 50 / `NOT_FOUND` 0, treats `FOUND` below
    `UNCERTAIN_CONFIDENCE_THRESHOLD` (0.45) or without a stored quote as `UNCERTAIN`, multiplies
    the requirement weight by its category weight before normalising, and lets an unmet hard
    requirement override the thresholds with `REQUIREMENT_NOT_MET`. All of it lives in
    `services/scoring/engine.ts` and is described in `docs/DATABASE.md`; any change is a behaviour
    change and must bump `SCORING_ENGINE_VERSION` (currently `1.0.0`), because stored results are
    only reproducible by the version that produced them.
28. **A candidate can be `COMPLETED` with `score` NULL.** If a processor stored no evidence
    envelope (`analysis_json`), scoring deliberately leaves the candidate unscored instead of
    inventing a zero - production's extraction always stores one, but a stub or a future processor
    might not. Phase 15's results view must render that as "belum dinilai", not as a low score.
29. **Re-scoring overwrites, and `screening_criterion_results` carries no engine version.** The
    replace-in-one-transaction design keeps the rows consistent, but if the engine version changes
    and a candidate is re-scored, the old numbers are gone; the version is recorded on the job
    (`scoring_configuration_version`) and inside the candidate's `analysis_json` envelope, not per
    criterion row. Per-row score history would need a migration.
30. **Screening results are returned in full, with no pagination.** `GET .../results` loads every
    candidate of a batch (capped at 50 by the upload limit) plus all of its criterion rows and
    evidence. That is fine at 50 CVs x 40 criteria and avoids a paging model in the UI, but a
    larger batch would need pagination or a streamed report.
31. **Report bytes are still not stored.** `GeneratedReport` keeps the format, file name, size and
    SHA-256 with `storage_path` null; the bytes are returned inline as base64 and are gone after
    the download. Supabase Storage (Phase 19/21) is what makes "download it again" possible. The
    report list is therefore metadata-only by design - it never re-sends a payload.
32. **Reports are free, on purpose.** There is no report feature key in the pricing catalogue:
    producing the result is what `HRD_SCREEN_PER_CV` pays for, and rendering it again costs no AI
    call. Making reports a paid feature means adding a key to `packages/shared` and the pricing
    table, never a literal in the service.
33. ~~**The Phase 11 pre-existing web failures are still present**~~ **Resolved in Phase 20** with
    the same config fix as §8.15: the web workspace has no red suites.
34. **Verification does not yet cross-check a specific CV claim against the fetched page.** A
    page that was fetched and summarised is `SUPPORTED`; nothing compares "led a team of five"
    on the CV with what the page says, so `CONFLICTING_INFORMATION` is never produced and a
    missing mention stays `UNVERIFIED`. That comparison is a genuine feature (claim extraction +
    matching) and belongs with its own phase rather than being faked here.
35. **Verified link evidence does not re-enter the screening score.** The verified snapshots and
    candidate-level evidence rows appear in the results payload (`githubEvidence`,
    `portfolioEvidence`) and in the UI, but the criterion scores were already computed, and
    re-running extraction would have to re-score idempotently. Until then `EVIDENCE_VERIFICATION`
    adds context for the recruiter, not points on the score.
36. **The guarded fetcher has never touched the real internet.** No outbound network in this
    environment, so `GuardedHttpProvider` is covered by unit-level DNS/redirect/size logic and
    the mock provider, but a real GitHub request, a real redirect chain and a real slow server
    are unverified. `OUTBOUND_HTTP_PROVIDER` defaults to `mock`, so nothing fetches by accident.
37. **Link extraction is a URL regex over stored CV text.** It is deliberately conservative
    (http/https only, deduplicated, capped at three, LinkedIn never fetched) and is the reason a
    CV that writes "github.com/andi" without a scheme is not verified. A richer parser (or asking
    the extraction model for the links it saw) is a small, separate improvement.
38. **Testimonials have no admin console yet, only the API.** The moderation routes exist and are
    server-enforced (`GET /testimonials/moderation`, `PATCH /testimonials/:id/moderation`), but
    approving a review currently means calling the API by hand; the console that drives them is
    Phase 18. The landing page shows approved reviews once they exist.
39. **A review can only be edited by deleting it - which does not exist yet.** There is no
    `DELETE /testimonials/:id` and no update, so an author who mistypes has to ask an admin to
    reject it. Adding author-side edit/delete (with moderation reset) is a small follow-up.
40. ~~**`testimonials` have no rate limit of their own.**~~ **Resolved in Phase 19**:
    `POST /testimonials` carries a per-account fixed-window cap (5 per day) in front of validation,
    on top of the one-per-enhancement rule and the admin gate.
41. **The console shows aggregates, prices, testimonial moderation, failed candidates and recent
    jobs - the rest is API-only.** Users, transactions, payments, webhook events and AI usage all
    have admin endpoints and validated contracts, but no screen yet; the page says so in place,
    so the gap is visible rather than implied.
42. **Admin access is all-or-nothing.** `requireAdmin` is a single role: an admin can change
    prices, hand out the role and adjust balances. There is no read-only or support role, and no
    per-action audit table beyond `FeaturePricing.updatedByUserId`,
    `CreditTransaction.referenceId` (the admin id) and `credit_reservations` metadata. A second
    role tier is a schema change, not a config change.
43. **The admin console is not code-split.** It is another route in the main bundle (now 758 kB /
    213 kB gzipped),
    which strengthens the case for route-level `lazy` before launch (§8.6).
44. **`@aseb/shared` exports two weight helpers nothing calls.**
    `validateCategoryWeights` / `normaliseWeights` (`packages/shared/src/utils/weights.ts`) are
    covered by `tests/shared-weights.test.ts` but unused: category-weight validation happens in
    `categoryWeightsSchema` and normalisation in the scoring engine's own (tested, versioned) rule
    set. Two implementations of "how weights work" is a refactor waiting to go wrong - either the
    engine should consume the shared helper (a behaviour change needing a version bump) or the
    helper should be deleted.
45. ~~**Playwright has never run.**~~ **Resolved 2026-09-26.** The browser suite is green on the
    owner's Mac: `npm run test:e2e` → **5 passed** in 5.6s (`landing`, `audit`, `signin`, and two
    screening flows that create a job, upload a CV, read ranked evidence, export a CSV and top up
    through the real checkout + webhook path). Getting there needed four rounds of fixes, each
    recorded above: readiness and provider pinning (§8.54), the browser auth-strategy leak (§8.55),
    and two spec bugs of mine - a sign-up request aborted by an immediate navigation (§8.58) and a
    missing credit top-up that correctly produced `402` (§8.59). The diagnostics added to
    `e2e/helpers/session.ts` are what made the last two obvious.
46. **The Docker stack has never been built.** There is no Docker daemon in the agent environment,
    so the Dockerfiles and `docker-compose.yml` are verified only structurally (YAML parses, the
    dependency graph and healthchecks are as intended, every copied path and every invoked npm
    script exists). The first `docker compose up --build` is an owner-run step; expect to fix image
    details rather than application code. Two known trade-offs are deliberate: the API image
    carries dev dependencies (the Prisma CLI is needed by the `migrate` target) and ships without
    Chromium (`PDF_RENDERER=mock`, documented in the README).
47. **`TEST_DATABASE_URL` was documented for months but never implemented.** `AGENTS.md`,
    `README.md` and `docs/DATABASE.md` told contributors they could point the integration suites at
    a real PostgreSQL instance with that variable; `tests/helpers/db.ts` only ever booted PGlite,
    and the variable appeared solely inside the bind-failure error message. The message and the two
    documents now say PGlite is the only supported path (§8.4). Implementing the fallback (a `pg`
    Pool behind the harness's minimal SQL interface plus `prisma migrate deploy`) is a small,
    self-contained piece of test infrastructure - `AGENTS.md` still mentions the variable and needs
    an owner decision before it is edited.
48. **The pipeline has never run and Playwright has never launched a browser.** `gitlab-ci.yml` is
    verified only structurally (YAML shape, job/stage/service wiring, referenced scripts exist) and
    `playwright test --list` proves the config loads and finds four specs, but the first real
    pipeline is where the remaining details surface - cache paths, the Playwright image tag versus
    `@playwright/test` 1.63, and the E2E locators (§8.45). Expect to iterate there, not in the
    application code.
49. **The Phase 21 Dockerfiles needed a fix during Phase 22.** They used `npm ci --ignore-scripts`,
    which would have skipped `@prisma/engines`' postinstall and broken `prisma generate` /
    `prisma migrate deploy` inside the image. Both Dockerfiles now install with scripts enabled and
    disable only Chromium and husky. Caught by reasoning about the install graph, not by a build -
    the first `docker compose up --build` remains the real test (§8.46).
50. **`docs/DEPLOYMENT.md` describes a deployment nobody has performed.** It was written from the
    code, `docs/SECURITY.md` and this document, so its commands are consistent with the repository
    but unproven end to end: the pooler/SSL details come from §6's hard-won notes, the compose
    commands from §8.46's structural check only. Treat the first run as a rehearsal and correct the
    runbook where reality differs - that is what it is for.
51. **The testimonial moderation routes mounted `requireAdmin()` without `requireAuth()`** (found by
    the full suite on 2026-09-26, fixed). `requireAdmin` only reads the context `requireAuth` puts on
    the request, so **every** moderation call - including an admin's - answered `401`: approving a
    testimonial was impossible through the API. Fixed in `testimonial.routes.ts`, and
    `tests/route-guards.test.ts` now asserts the invariant for every router (mutation-verified: it
    fails when the bug is reintroduced).
52. **The queue runner scored a stale candidate** (found by the same run, fixed). `processCandidate`
    loaded the candidate _before_ the processor ran, then called
    `scoring.scoreAndStore({ job, candidate })` with that snapshot - whose `analysisJson` is still
    `null`. Scoring therefore never saw the evidence that had just been extracted: every candidate
    ended `COMPLETED` with `score: null`, no `screening_criterion_results`, empty
    `unmetHardRequirements` and a report with no criteria. That was a production bug, not a test
    artefact. The runner now passes the fresh envelope explicitly
    (`scoring.service.ts` accepts an `envelope` override) and
    `tests/screening-runner-scoring.test.ts` pins it (mutation-verified).
53. **The multipart `options` field of `POST /api/cv/enhance` was silently discarded** (found by the
    same run, fixed). `enhanceCvUploadBodySchema` validated the parsed JSON against
    `enhanceCvRequestSchema`, which expects the _wrapper_ shape `{ options: {...} }`; a bare options
    object parsed "successfully" through the `.default()`, so every field - `targetPosition`,
    `targetCareer`, links, `additionalNotes`, `useProfileContext` - was replaced by its default and
    never reached the prompt. The browser sends exactly that bare object, so targeting and the
    consent gate were inert in production. The field is now validated with
    `cvEnhancementOptionsSchema` and wrapped, and `tests/enhance-upload-options.test.ts` pins it.
54. **The first real Playwright run timed out waiting for its own servers** (2026-09-26, fixed).
    Both servers started - the log shows the API on :4000 and Vite on :5173 - but the readiness
    probes used `http://127.0.0.1:...` while the servers advertise `localhost` (which macOS
    resolves to IPv6 first), and the API probe hit `/api/health`, which performs a database
    round-trip: a paused or unreachable Supabase project made the probe hang for the full 120 s
    instead of failing loudly. `apps/web/playwright.config.ts` now waits on **ports** (4000/5173),
    so readiness no longer depends on the database or on the address family. The same run also
    showed the API under test starting with the developer's real configuration
    (`aiProvider: deepseek`, `paymentProvider: midtrans`), so the E2E web server now pins
    `AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, `PDF_RENDERER=mock`,
    `OUTBOUND_HTTP_PROVIDER=mock` and `AUTH_DEV_MODE=true`: a browser run never calls a paid
    provider and never depends on the developer's `.env`. The browser suite itself has still not
    completed a green run (§8.45) - expect locator fixes - and the local recipe (migrated database
    from `docker compose up -d db redis`) is documented in the README.
55. **The second Playwright run exposed the same environment leak in the browser** (2026-09-26,
    fixed). Readiness was fine this time - both servers started with `aiProvider: mock` and four
    specs ran, and the guest-audit spec **passed** end to end - but both screening specs timed out
    waiting for the create form, and the API log showed **no** `POST /api/auth/dev/sign-up`.
    Reason: the API was pinned to the development auth strategy while the _browser_ still ran with
    the developer's `VITE_SUPABASE_*` mirrors, so sign-up went through the real Supabase SDK (no
    session, because that project requires email confirmation) and `/screening` correctly rendered
    its signed-out gate. Fixed by committing `.env.e2e` (empty `VITE_SUPABASE_*`) and starting the
    web server with `vite --mode e2e`, which overrides the developer `.env`; verified offline by
    building with a marker `VITE_SUPABASE_URL` in `.env` - present in the default build, absent
    with `--mode e2e`. `reuseExistingServer` is now `false` for both servers, so the suite can
    never assert against a differently configured instance, and the web server uses `--strictPort`
    so a busy 5173 fails loudly instead of moving to 5174 and leaving the probe waiting. The
    landing spec's duplicate-text matcher (`Pencari Kerja` appears in the subtitle too) was
    narrowed with `exact: true`.
56. **`.env` is the only copy of the local secrets, and an agent destroyed it** (2026-09-26,
    restored). While verifying that `.env.e2e` overrides `.env` for Vite, the check wrote a marker
    file to `./.env` and deleted it afterwards - but that path already held the owner's real 6.3 kB
    environment file, so the next `npm run db:deploy` failed with "The datasource.url property is
    required in your Prisma config file" (the config was fine; the file was gone). It was recovered
    from VS Code's local history (37 versions of that exact path; the newest, 12:26, restored) and
    `.env` has never been committed. **Rule for any future verification: never write to or delete
    `.env`** - copy the repository environment into a throwaway directory and point `envDir` at it,
    or use `loadEnv` in a temp sandbox. The file is the single source of truth for this machine's
    credentials; `.env.example` holds placeholders only.
57. **Environment changes are the owner's to make.** Standing rule agreed on 2026-09-26: an agent
    never writes to, renames or deletes `.env`; it states the exact lines to add or change and the
    owner applies them. Verification that needs different values must use a throwaway location (a
    temp `envDir`, an exported variable on the command line) or read the file without printing
    values. Related, and deliberate: `apps/web/playwright.config.ts` resolves the browser suite's
    database as `E2E_DATABASE_URL` -> `DATABASE_URL` (exported, else `.env`) -> disposable compose
    Postgres, so the suite can be pointed at a throwaway database without touching the application's
    own configuration.
58. **The screening specs aborted their own sign-up.** Third Playwright run (2026-09-26, with the
    local Postgres): landing and audit passed, the screening specs still timed out on the create
    form, and the API log showed `POST /api/auth/dev/sign-up` as **request aborted** twice. The spec
    clicked submit and called `page.goto('/screening')` immediately, so the navigation cancelled the
    in-flight request, no token was stored, and `/screening` correctly showed its signed-out gate.
    Fixed by not driving the form from the batch specs: `e2e/helpers/session.ts` creates the account
    through the development API and seeds `localStorage` with `addInitScript` before the first
    navigation, while a dedicated `e2e/signin.spec.ts` keeps the form covered and asserts the
    outcome (stored token + redirect to `/profile`) instead of racing it. The suite is now five
    specs in four files.
59. **The screening specs forgot the credits.** Fourth Playwright run (2026-09-26): landing, audit
    and the new sign-in spec passed, and the diagnostics added in §8.58 paid off immediately - the
    two screening specs failed on a page that never received a result because the upload was
    answered `402 INSUFFICIENT_CREDITS`. The product was right: a fresh account has no credits and a
    batch reserves `HRD_SCREEN_PER_CV` per accepted CV. The specs were incomplete, so
    `e2e/helpers/session.ts` gained `topUpViaApi`, which drives the real flow - checkout with the
    smallest package, then the development `simulate` endpoint through the signature-verified,
    idempotent webhook path - and the browser suite now covers the payment path as a side effect.
    A custom credit amount is deliberately not used because anything below the rupiah minimum is
    rejected by design.
60. **The browser suite wrote its test data into the developer's Supabase project** (2026-09-26,
    fixed). `playwright.config.ts` called `loadDotenv()` on the repository `.env` whenever
    `DATABASE_URL` was not exported, so a plain `npm run test:e2e` resolved its database from `.env`
    and created the suite's `e2e-...@example.com` accounts, screening batches, credit rows and
    reports in that project - it never touched a local Postgres, which is why it went unnoticed. The
    same loaded values also leaked `VITE_SUPABASE_*` into the browser process, which is the failure
    mode §8.55 had patched only at the `.env.e2e` level: the SDK took the browser over while the API
    under test only accepted development tokens, and three specs failed. The config now never reads
    `.env`: it resolves `E2E_DATABASE_URL`/`E2E_DIRECT_URL`, then `DATABASE_URL`/`DIRECT_URL`
    **from the environment** (CI's service, or an exported URL), then the disposable Compose
    Postgres; it refuses a non-local host unless `E2E_ALLOW_REMOTE_DATABASE=1` is set, and it prints
    the host it is about to write to. Verified against a disposable `postgres:16-alpine` container:
    with no variables exported the run reports `[e2e] database: localhost (local)`, passes 5/5, and
    the container holds the created rows; an exported Supabase URL is refused with instructions.
61. **The CI e2e job pointed the browser at an address the dev server was not listening on**
    (2026-09-26, fixed). The job sets `E2E_BASE_URL=http://127.0.0.1:5173`, while `vite --mode e2e`
    binds whatever `localhost` resolves to - on macOS that is `::1` first, so every spec died with
    `net::ERR_CONNECTION_REFUSED` even though Playwright's port probe (which checks both families)
    reported the server ready. Reproduced locally with the job's own environment
    (`E2E_BASE_URL=http://127.0.0.1:5173 CI=true npm run test:e2e`): 5 failed before, 5 passed after
    pinning the dev server with `--host 127.0.0.1`, defaulting `baseURL` to the same host, and
    pointing the Vite proxy at `http://127.0.0.1:4000`. This is the same IPv4/IPv6 trap as §8.54,
    one layer up: the readiness probe was fixed there, the browser's own navigation was not.
62. **Every rate limiter counted the same bucket per IP** (2026-09-26, fixed). `rateLimit()` built
    its key from the client address alone, so the generic API limiter (120/min), the two development
    credential routes (10 and 20/min) and the profile-link route (10/min) all incremented one
    counter: after ten requests of _any_ kind in a minute, `POST /api/auth/dev/sign-up` answered
    `RATE_LIMITED`. Reproduced with twelve harmless `GET /api/credits/pricing` calls followed by a
    first sign-up - 429 before the fix, 201 after. A real user could be locked out of signing in or
    up simply by using the app. It was also the second cause of the red CI e2e job: with the runner's
    single worker the suite issues its sign-ups after the polling traffic, while a five-worker local
    run issues them first, which is why the same code passed here and failed there.
    `RateLimitOptions` now requires a `scope`, the key is `${scope}:${identity}`, every call site has
    one, and `tests/rate-limit.test.ts` pins that unrelated traffic cannot exhaust another limiter's
    quota.
63. **Bulk "Verifikasi semua" for screening results** (2026-09-27, added). The HRD results screen
    now discloses the per-candidate verification price before anything is clicked, confirms both
    the individual and the bulk action in a modal that shows the balance before/after, and offers
    a bulk button that verifies every eligible candidate of the job in one request instead of
    firing parallel per-candidate calls from the browser. New endpoints:
    `GET /api/screening/jobs/:jobId/verification/estimate` (preflight: server-resolved
    `unitCredits`, eligible/already-verified/in-progress/no-link counts, total, balance and
    shortfall) and `POST /api/screening/jobs/:jobId/verification` (bulk). Eligibility is
    server-side: `state === 'COMPLETED'`, `verificationStatus !== 'SUPPORTED'`, and at least one
    fetchable (non-LinkedIn) link. All-or-nothing credit validation: the whole hold
    (`unitCredits x eligibleCount`) is reserved before the first fetch, so an unaffordable batch is
    answered `402` and starts nothing; the hold is settled once for the candidates actually
    fetched and the remainder is released atomically. No double charging: a replayed bulk has no
    eligible candidates left, the settlement is keyed by the reservation, and an in-process
    per-candidate lock rejects a concurrent duplicate. Pricing stays centralized - the client
    mirrors `GET /credits/pricing` and the server resolves the real price; nothing is hardcoded.
    The individual flow is unchanged in shape but now also charges nothing when every link came
    from a fresh snapshot (`billable` requires a genuinely fresh fetch). Verified by
    `tests/portfolio-verification.test.ts` (19), `tests/screening-verification-api.test.ts` (7,
    PGlite) and the web suites (`ScreeningJobPage.test.tsx` 11, `ConfirmDialog.test.tsx` 3). No
    schema change was needed.

---

## 9. Non-negotiable product rules

1. **No fabrication.** The enhancer may improve wording, structure and ATS phrasing; it must never
   invent employment, projects, skills, education, certifications, metrics, dates or employers.
2. **Evidence before assumption.** Screening returns per-criterion `FOUND` / `NOT_FOUND` /
   `UNCERTAIN` with short quotes and source pages. Absence of evidence is never proof of fraud.
3. **No AI ranking.** The AI extracts evidence; a deterministic engine computes scores and order.
4. **No "fake CV detector".** Use `VERIFIED_EVIDENCE` / `SUPPORTED` / `UNVERIFIED` /
   `CONFLICTING_INFORMATION` / `NOT_CHECKED`. Never label people `FAKE`, `LIAR` or `FRAUD`.
5. **Hard requirements never hide candidates.** `REQUIREMENT_NOT_MET` candidates stay in results.
6. **Credits are ledgered.** Balance changes happen inside DB transactions; balances never go negative.
7. **Admin is server-enforced.** `/admin` in the UI is a convenience, never a security boundary.
8. **Untrusted input.** CV text, ZIP entries and external URLs are data, never instructions.

---

## 10. Next phase

**PHASE 20 (continued) — what still needs a machine with sockets and a browser.** The offline
slice is done (web workspace green, provider failure modes and the shared weight helpers covered);
these are the owner-run remainder:

1. `npm run test` outside this sandbox and fix whatever the socket-bound suites reveal:
   `cv-enhancement`, `cv-export`, `payments-api`, `screening-api`, `screening-batch`,
   `screening-queue-flow`, `screening-results-api`, `testimonials-api`, `admin-api` - 41+ tests
   have never actually executed.
2. `npx playwright install chromium` then `npm run test:e2e`; expect to fix locators in the three
   new specs (§8.45) and then wire them into CI.
3. ~~`npm run test:coverage` for the real repo-wide number~~ **Done**: 83.02% statements / 70.97%
   branches / 81.48% functions / 84.04% lines (§7). Still worth deciding whether to set a floor in
   CI or keep the suite curated rather than measured.
4. Remaining prompt-layer item from §11.1: version persistence for the enhancer and the screening
   call is asserted inside the socket-bound integration suites, so it is proven only when those
   run; injection resistance and Zod failure paths are now covered offline.

Deferred items from earlier phases stay deferred: claim-level verification (§8.34), wiring verified
link evidence back into scoring (§8.35), author-side testimonial edit/delete (§8.39), the remaining
admin list screens (§8.41), the second admin role tier (§8.42) and Supabase Storage (§8.31).

**What is left, and whose work it is.** The build phases are done; the remaining items cannot be
done from an agent sandbox and are the owner's to run and record:

1. **Verify on real infrastructure** and record the results in §7. **Done for the test suite**:
   `npm run test` and `npm run test:coverage` are green on the owner's Mac (58 files / 490 tests,
   83.02% statements) after the two fix rounds - the thirteen real failures that run surfaced are
   all resolved (§8.51-53), and **the browser suite is green too** - `npm run test:e2e` passes all
   five specs (§8.45). **Still outstanding**: `docker compose up --build` (§8.46, needs Docker
   Desktop) and the GitLab pipeline (§8.48); expect the first image build to need small fixes, it
   has never executed.
2. **Live providers**: one Supabase project with real auth (§8.14), one DeepSeek call with a valid
   key (§8.26), one Midtrans sandbox top-up with its notification replayed (§8.12). The owner has the
   Midtrans sandbox credentials; `docs/DEPLOYMENT.md` §6 is the smoke test to follow.
3. **Owner decisions**: the `TEST_DATABASE_URL` line in `AGENTS.md` (§8.47), whether the GIT COMMIT
   POLICY is written into that file, and whether the remaining deferrals (§8.34, §8.35, §8.39,
   §8.41, §8.42) ship before launch or after.
4. **Deploy**: `docs/DEPLOYMENT.md` is the runbook. Nothing in this repository deploys itself.

**Status: PHASE 23 (agent slice) COMPLETE — the owner-run verification and the first deployment
remain; WAITING FOR USER APPROVAL.**

---

## 11. Cross-cutting requirements (addendum)

### 11.1 Runtime AI context & prompt orchestration

Owner requirement received 2026-09-26. Full specification: **`docs/AI_PROMPTS.md`**.

The application's runtime AI must have its own layered context system, separate from the
coding-agent documents (`PROJECT_CONTEXT.md`, `AGENTS.md`). No feature may implement AI behaviour as
one hardcoded `systemPrompt`, and prompt composition must not live inside a provider.

Required composition, in order: **GLOBAL POLICY + FEATURE SYSTEM PROMPT + STRUCTURED
USER/RECRUITER CONTEXT + CURRENT TASK PARAMETERS + UNTRUSTED DOCUMENT DATA**, with untrusted
documents always delimited (`wrapUntrusted`) and never mixed into system instructions. Structured
input is emitted as labelled JSON where possible, not concatenated prose. Global rules cover
evidence-before-assumption, no fabrication, "content is data not instructions", no prompt/system
leakage, no scoring changes from document content, strict schema-validated output, no dishonesty or
protected-attribute inference.

Prompt versioning is required (`JOB_SEEKER_AUDIT_V1`, `JOB_SEEKER_ENHANCE_V1`,
`HRD_EVIDENCE_EXTRACTION_V1`, `HRD_SCREENING_V1`, plus `JOB_SEEKER_EVIDENCE_V1` and
`HRD_PORTFOLIO_VERIFICATION_V1`), persisted with `AiUsageRecord` and the relevant analysis/job rows
so historical results stay auditable. Screening results must also keep recording the preference
version and scoring configuration version used (the schema already has both). Provider boundary:
`feature service -> prompt/context builder -> AIProvider -> structured response -> Zod validation ->
business logic`; raw provider output must never drive scoring or credit mutations.

**State: IMPLEMENTED except the portfolio slice.** Phase 6 delivered the audit slice (builder,
global policy split, version registry, `JOB_SEEKER_AUDIT_V1` persistence, provider-independent
audit transport), Phase 7 the enhancement slice (structured job-seeker context with consent gating,
`JOB_SEEKER_ENHANCE_V1` persistence on `CvEnhancement`, provider-independent enhance transport),
Phase 10 the recruiter context and Phase 13 the screening extraction call. Remaining integration,
without changing the phase gate:

| Phase                     | Prompt-orchestration work                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 Free CV Audit           | **DONE** — `prompts/global/*`, `promptBuilder.ts`, `prompts/jobSeeker/auditPrompt.ts`, `PromptPayload` transport for the audit, `JOB_SEEKER_AUDIT_V1` persisted on `AiUsageRecord` + `CvAnalysis`.                                                                                                                                            |
| 7 Paid CV Enhancer        | **DONE** — `prompts/jobSeeker/enhancePrompt.ts` with a structured job-seeker context block and a consent gate; `PromptPayload` transport for the enhancement; `JOB_SEEKER_ENHANCE_V1` persisted on `AiUsageRecord` + `CvEnhancement`.                                                                                                         |
| 10 Recruiter Requirements | **DONE** — `hrd/screeningPrompt.ts` (`HRD_SCREENING_V1`) composes the recruiter preference/scoring context with `preferenceVersion`, persisted on `ScreeningJob.promptVersion`.                                                                                                                                                               |
| 13 Evidence Extraction    | **DONE** — the real call lives in `hrd/evidenceExtractionPrompt.ts` (`HRD_EVIDENCE_EXTRACTION_V1`), the provider only transports `PromptPayload`, the mock reads the composed layers, and the version is persisted on `AiUsageRecord.promptVersion` plus the candidate's versioned `analysis_json` envelope (no migration needed; see §8.23). |
| 16 Evidence Verification  | New `prompts/hrd/portfolioVerificationPrompt.ts` replacing the inline provider prompt; `HRD_PORTFOLIO_VERIFICATION_V1`.                                                                                                                                                                                                                       |
| 20 Testing                | Layer-order, delimiter, version-persistence, injection-resistance and validation-failure tests.                                                                                                                                                                                                                                               |

The screening-evidence and portfolio prompts still run through the transitional `promptFromParts`
inside the provider; Phases 13 and 16 replace them with real feature modules. Open questions for the
owner are listed in `docs/AI_PROMPTS.md` §14.
