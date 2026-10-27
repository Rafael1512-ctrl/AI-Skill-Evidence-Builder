# DATABASE.md

> Owner phase: **Phase 3 — Database**. Read together with `PROJECT_CONTEXT.md`,
> `apps/api/prisma/schema.prisma` and `docs/SECURITY.md` (privacy rules).
>
> This document describes the data model as it actually exists. If it disagrees with
> `schema.prisma`, the schema is the source of truth and this file is a bug.

---

## 1. Engine and tooling

| Concern            | Decision                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| Engine             | PostgreSQL (Supabase in production, PGlite/PostgreSQL in tests)         |
| ORM                | Prisma 7 with the `@prisma/adapter-pg` driver adapter                   |
| Schema file        | `apps/api/prisma/schema.prisma`                                         |
| Generated client   | `apps/api/src/generated/prisma` (git-ignored, rebuilt by `npm run gen`) |
| Connection config  | `apps/api/prisma.config.ts` (Prisma 7 moved URLs out of the schema)     |
| Migrations         | `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`           |
| Current migrations | `20260926000000_init` (single initial migration)                        |

No environment has ever been deployed, so the `prompt_version` columns added in Phases 6
and 7 were folded into `20260926000000_init` rather than added as separate migration
folders: `tests/database-schema.test.ts` requires the committed migration SQL to equal
`prisma migrate diff --from-empty`, and that equality cannot hold across two folders.
**From the first real deployment onward every change is a new additive migration
folder; an applied migration is never edited.**

Connection URLs:

- `DATABASE_URL` — pooled connection used by the running API.
- `DIRECT_URL` — unpooled connection, preferred by `prisma migrate` / `prisma studio`
  against Supabase. The config falls back to `DATABASE_URL` when `DIRECT_URL` is unset.

### Naming conventions

- TypeScript/Prisma models are `camelCase`; every table and column maps to `snake_case`
  in PostgreSQL through `@@map` / `@map`.
- Primary keys are `String @id @default(cuid())`.
- Every table carries `created_at`; mutable tables also carry `updated_at`
  (`@updatedAt`).
- **Money is integer rupiah** (`amount_idr`). **Credits are integers.** No floats are
  used for balances or prices. Provider cost estimates are the only decimal values
  (`Decimal(12, 6)`, USD), and they never touch a user's balance.
- Soft deletes are explicit columns (`cv_documents.deleted_at`), never row removal, when
  the user must keep history.

---

## 2. Model map

23 models, grouped by domain. Table name = PostgreSQL identifier.

### Identity

| Model          | Table             | Purpose                                                                                                                               |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `User`         | `users`           | One account usable for **both** job-seeker and recruiter workflows. Holds profile fields, `role`, verification flags.                 |
| `AuthIdentity` | `auth_identities` | One row per sign-in method for a user (`PASSWORD`, `GOOGLE`). Holds the provider subject and, in dev mode only, a password hash/salt. |

Key details:

- `users.email` is globally unique; profile fields (`linkedin_url`, `github_url`,
  `portfolio_url`, `headline`, …) are optional.
- `google_connected` / `email_verified` drive the "Google accounts are considered
  verified" rule. There is no `JOB_SEEKER` vs `HRD` role — that split does not exist by
  design.
- `auth_identities(provider, provider_user_id)` is unique, so one provider identity maps
  to exactly one user.
- An account created by email/password can later be linked to Google: `upsertFromAuth`
  matches on `(provider, providerUserId)` first, then on `email`, and links instead of
  duplicating.

### Credit economy

| Model               | Table                 | Purpose                                                                                           |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `CreditWallet`      | `credit_wallets`      | One wallet per user (unique `user_id`). Owned balance, reserved credits, lifetime counters.       |
| `CreditTransaction` | `credit_transactions` | Append-only ledger. Every balance change produces exactly one row.                                |
| `CreditReservation` | `credit_reservations` | Holds credits for an in-flight expensive operation until it settles or is released.               |
| `FeaturePricing`    | `feature_pricing`     | Optional admin override of the shared default credit price per feature.                           |
| `AiUsageRecord`     | `ai_usage_records`    | Internal provider-cost accounting (tokens, USD cost, latency, prompt version). Never user-facing. |

Payments:

| Model                 | Table                    | Purpose                                                                                         |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `PaymentTransaction`  | `payment_transactions`   | One top-up attempt with a provider (mock or Midtrans).                                          |
| `PaymentWebhookEvent` | `payment_webhook_events` | Every inbound webhook, stored before processing. Unique `event_key` defeats duplicates/replays. |

### CV documents, analyses and enhancements

| Model           | Table             | Purpose                                                                                                          |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CvDocument`    | `cv_documents`    | Uploaded or generated CV. Stores metadata plus extracted plain text when the workflow is persistent.             |
| `CvAnalysis`    | `cv_analyses`     | Validated free-audit / deep-analysis result (`result` JSON), with score, credits charged and prompt version.     |
| `CvEnhancement` | `cv_enhancements` | Paid enhancement: options, generated document JSON, template, status, credits, reservation link, prompt version. |

Key details:

- `cv_documents.user_id` is nullable because the anonymous free audit must not be
  attributed to an account. Anonymous audits persist **no row at all**
  (`is_ephemeral` exists for explicitly requested ephemeral records).
- `deleted_at` plus clearing `text_content` is the deletion path used by
  `CvRepository.deleteDocument`.
- `cv_enhancements.source_document_id` links the uploaded CV; `result_document_id` links the
  generated PDF export record (`CvDocument.kind = ENHANCED`) once the user exports it, and is
  rewritten when they export again with another template (`ON DELETE SET NULL`, so history
  survives). `CvEnhancement.templateKey` then reflects the last exported template.
- The generated PDF **bytes** are returned to the user and are not persisted: there is no
  storage provider yet (`SUPABASE_STORAGE_ENABLED=false`). The `ENHANCED` `CvDocument` stores the
  metadata, the SHA-256 of the bytes and a plain-text rendition of the document, so the record
  stays searchable and auditable. Once Supabase Storage is wired, the same row gains a
  `storage_path`-style pointer (`generated_reports` already models that pattern for screening).
- `cv_enhancements.prompt_version` records which runtime prompt produced the stored
  document (`JOB_SEEKER_ENHANCE_V1` today). It is `NULL` for rows written before Phase 7
  and is set when the enhancement row is created, before the model call, so a failure is
  still attributable.

### Recruiter screening

| Model                         | Table                            | Purpose                                                                                                                 |
| ----------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `RecruiterPreference`         | `recruiter_preferences`          | Current structured preferences for a recruiter + monotonic `version`.                                                   |
| `RecruiterPreferenceVersion`  | `recruiter_preference_versions`  | Immutable snapshot per version, so old results stay reproducible.                                                       |
| `ScreeningJob`                | `screening_jobs`                 | One batch screening, its state, frozen configuration versions, progress counters and credit totals.                     |
| `ScreeningRequirement`        | `screening_requirements`         | One criterion: text, category, `REQUIRED`/`PREFERRED`/`BONUS`, weight, `hard_requirement`.                              |
| `ScreeningCandidate`          | `screening_candidates`           | One CV in a batch: extracted text, state, score, eligibility, structured analysis.                                      |
| `ScreeningCriterionResult`    | `screening_criterion_results`    | Per candidate × requirement outcome: evidence status, verification status, confidence, earned score, normalised weight. |
| `EvidenceItem`                | `evidence_items`                 | Short quote + source + optional page/URL supporting a criterion result.                                                 |
| `IntegrationEvidenceSnapshot` | `integration_evidence_snapshots` | Cached GitHub / portfolio / self-reported-LinkedIn evidence for a user profile.                                         |
| `GeneratedReport`             | `generated_reports`              | Exported screening report metadata (PDF/CSV), hash and optional storage path.                                           |
| `ScreeningJobEvent`           | `screening_job_events`           | Append-only progress/error log for a job (feeds admin "failed jobs").                                                   |

Key details:

- `screening_requirements(job_id, sort_order)` is unique, so criteria keep a stable order.
- `screening_criterion_results(candidate_id, requirement_id)` is unique: one verdict per
  criterion per candidate.
- Scoring is reproducible: a job freezes `scoring_configuration_version`,
  `preference_version`, `requirement_version` and `prompt_version`
  (`HRD_SCREENING_V1`) at creation time.

#### Recruiter preferences and job creation (Phase 10)

- **Preferences are versioned, never overwritten.** `recruiter_preferences` holds the
  current row plus a monotonic `version`; every save also writes an immutable
  `recruiter_preference_versions` snapshot in the same transaction. A read never writes:
  a recruiter who has never saved gets `version: 0` and the immutable shared defaults
  (`recruiterPreferencesSchema.parse({})`), which need no snapshot because they cannot
  change without a code change.
- **Job creation freezes what it used.** `ScreeningJob.preferenceVersion` is the version
  that was current at creation (0 when the recruiter opted out with
  `useRecruiterPreferences: false`, in which case no weights or notes are inherited).
  `promptVersion` defaults to `HRD_SCREENING_V1` and is set explicitly by the service.
- **Category weights are all-or-nothing.** `categoryWeightSchema` is an enum-keyed Zod
  record, so a supplied map must cover all six `ScoringCategory` values and total exactly
  100; a partial map is rejected rather than silently renormalised. Job-level
  `category_weights` override the recruiter default, and stay `NULL` when neither is set.
- **No credits move at creation.** Candidates, reservation/settlement of
  `HRD_SCREEN_PER_CV` and queueing belong to Phases 11-12; `reservation_id`,
  `credits_reserved` and `credits_charged` stay `NULL`/`0` until a batch is submitted.
- Every creation and cancellation appends a `screening_job_events` row
  (`STATE_CHANGED`), which is the audit trail the later phases and the admin console read.

#### Batch upload and the credit hold (Phase 11)

- **One batch per job.** `POST /api/screening/jobs/:jobId/candidates` accepts up to
  `LIMITS.MAX_SCREENING_CVS` (50) PDFs, or one ZIP bounded by `MAX_ZIP_ENTRIES` and
  `MAX_ZIP_UNCOMPRESSED_BYTES`, in the multipart field `files`. A second upload for a job
  that already has candidates is rejected with `409`, so `screening_jobs.reservation_id`
  and `credits_reserved` always describe exactly one batch.
- **Credits are reserved per accepted CV before the batch is written.**
  `HRD_SCREEN_PER_CV x accepted` is held through `CreditService.reserve` (the amount is
  always resolved by the pricing service, never a literal) and linked to the job. If the
  batch cannot be persisted, the hold is released again, so an `ACTIVE` reservation can
  never exist without its candidates. The hold stays `ACTIVE` through Phase 11:
  per-candidate settlement arrives with the queue (Phase 12) and evidence extraction
  (Phase 13).
- **Rejected files are never billed.** `ScreeningCandidate` rows are only written for CVs
  whose text extracted successfully; a scanned PDF, a non-PDF ZIP entry or an oversized
  file comes back in `rejected` and costs nothing.
- **`screening_candidates.cv_text` is sensitive candidate data.** It holds the extracted
  CV body and is never returned by `GET .../candidates`, which exposes metadata and
  processing state only. `text_hash` is the SHA-256 of that text, so a row can prove which
  content it was built from without keeping a second copy.
- **A batch is one transaction:** every candidate row, the `screening_jobs` counter update
  (`state = QUEUED`, `total_candidates`, `credits_reserved`, `reservation_id`) and the
  audit events (`CANDIDATE_QUEUED` per candidate, plus one `STATE_CHANGED`) commit
  together or not at all.
- **Batch order is `file_name`, not `created_at`.** PostgreSQL's `now()` is
  transaction-stable, so all candidates of a batch share one `created_at`; the API
  therefore pages by `(file_name, id)` for a stable order. The upload response still
  returns the files in upload order.
- **No migration was needed.** `screening_candidates`, `screening_jobs.reservation_id` /
  `credits_reserved` and `ScreeningJobEventType.CANDIDATE_QUEUED` already existed from
  Phase 3.

#### Queue processing and settlement (Phase 12)

- **No migration was needed.** The queue reuses `screening_candidates.state`/`attempts`/
  `started_at`/`completed_at`, `screening_jobs.state`/`started_at`/`completed_at` and the
  existing `CANDIDATE_*`/`PROGRESS`/`ERROR` event types.
- **`attempts` counts real tries.** The runner increments it once per processing attempt rather
  than trusting a broker counter, so the value is the same whether the work came from BullMQ,
  the in-process driver or a redelivery after a crash. A retry puts the candidate back in
  `QUEUED` with the failure reason attached; the final attempt moves it to `FAILED`.
- **The batch state is derived, then written once.** `screening_jobs.state` follows the
  candidate counts: anything still `QUEUED`/`PROCESSING` keeps the job `PROCESSING`,
  all-`COMPLETED` becomes `COMPLETED`, a mix becomes `PARTIALLY_COMPLETED` and all-`FAILED`
  becomes `FAILED`. `started_at` is set by a conditional update, so many workers starting
  candidates concurrently still record one real start.
- **One settlement per batch, for what was delivered.** Phase 11's `ACTIVE` reservation is
  settled with `unitPrice x completed`; `settleReservation` charges that amount and releases
  the remainder in the same atomic step, so a partial or fully failed batch is never billed for
  work that did not happen. After settlement `screening_jobs.credits_charged` holds the final
  number and `credits_reserved` returns to `0` (nothing is held any more), while the
  reservation row keeps the audit trail. A reservation settled at zero is `SETTLED` with
  `settled_credits = 0` - not `RELEASED`.
- **Cancellation settles too.** `PATCH /screening/jobs/:jobId` fails every candidate that has
  not finished, settles for the candidates that did, and finalises the job as `CANCELLED`, so a
  cancelled batch cannot leave an `ACTIVE` hold behind.
- **At-least-once delivery is safe.** A candidate already `COMPLETED`/`FAILED` is skipped, and
  settlement is idempotent through the reservation state and the ledger's idempotency key, so a
  redelivered job cannot double-charge.

#### Evidence extraction writes (Phase 13)

- **No migration was needed.** The extraction result fits the columns Phase 3 already defined:
  `screening_candidates.summary` / `gaps` / `uncertainties` / `analysis_json`, plus
  `ai_usage_records.prompt_version` linked by `screening_job_id` + `screening_candidate_id`.
- **`analysis_json` holds a versioned envelope** (`candidateEvidenceEnvelopeSchema` in
  `packages/shared`), not raw model output: the prompt, preference, scoring and requirement versions
  that produced the result, the provider/model, the grounding summary and the grounded evidence.
  One candidate row therefore stays auditable without a join, which is why no `promptVersion`
  column was added (see `PROJECT_CONTEXT.md` §8.23).
- **Only grounded evidence is stored.** `utils/evidence.ts` checks every quote against the CV text
  we hold before the write: an unfindable quote is dropped and a `FOUND` verdict that loses all of
  its quotes is downgraded to `UNCERTAIN`. The model may never upgrade a verdict.
- **Page numbers are not persisted.** `screening_candidates` stores the joined CV text, not its
  per-page breakdown, so a model-supplied page could not be verified and every stored quote carries
  `page: null` (`grounding.pageVerification = 'unavailable'`).
- **`screening_criterion_results` / `evidence_items` stay empty until Phase 14.** Both score columns
  on the criterion result (`earned_score`, `normalised_weight`) are non-nullable, and only the
  deterministic engine may write a score; until it runs, a candidate can be `COMPLETED` with
  `score` and `eligibility_status` still `NULL`.

#### Scoring writes (Phase 14)

- **No migration was needed.** Scoring fills the columns Phase 3 defined:
  `screening_criterion_results` (`status`, `confidence`, `earned_score`, `normalised_weight`,
  `notes`), `evidence_items` (one row per stored quote, linked to its criterion result) and
  `screening_candidates` (`score`, `eligibility_status`, `strengths`, `gaps`, `uncertainties`).
- **The numbers are reproducible from the rows.** `normalised_weight` is stored as a fraction of
  one (5 decimals) and `earned_score` as the criterion outcome (`FOUND` 100, `UNCERTAIN` 50,
  `NOT_FOUND` 0), so `sum(earned_score x normalised_weight)` equals the candidate's `score`.
  Influence is `requirement.weight x categoryWeights[category]` (1 when the job set none),
  normalised across the job's requirements.
- **A verdict can only lose credit.** A `FOUND` whose confidence is below
  `UNCERTAIN_CONFIDENCE_THRESHOLD` (0.45), or which has no stored quote, is scored as `UNCERTAIN`
  and its notes explain why. Nothing is ever upgraded, and a requirement with no verdict at all is
  treated as `NOT_FOUND` with a note.
- **An unmet hard requirement does not remove the row.** It changes `eligibility_status` to
  `REQUIREMENT_NOT_MET` while the score, criteria and evidence stay stored and readable, which is
  what keeps the candidate visible (the derived list of unmet requirements lives in
  `strengths`/`gaps` and in the criterion rows; there is no separate column).
- **Re-scoring replaces, never appends.** `replace_candidate_scores` deletes the candidate's
  criterion rows (their `evidence_items` cascade), rewrites them and updates the candidate in one
  transaction, so running the engine twice cannot duplicate a verdict or leave a stale score. The
  unique `(candidate_id, requirement_id)` key is the schema-level guard.
- **A candidate with no evidence envelope stays unscored** (`score`/`eligibility_status` `NULL`)
  rather than receiving a fabricated zero; the engine also re-validates that envelope on read and
  fails closed if it no longer matches the shared contract.
- **`verification_status` stays `NOT_CHECKED`** on every criterion and candidate until Phase 16.

#### Results and reports (Phase 15)

- **Reading results recomputes nothing.** `GET /screening/jobs/:jobId/results` joins the stored
  `screening_candidates`, `screening_criterion_results`, `screening_requirements` and
  `evidence_items` rows into the shared `candidateResultSchema` payload; the score, eligibility
  and derived lists are exactly what the engine wrote. Ranking is applied in the service (score
  desc, then name) rather than with `ORDER BY score DESC`, because PostgreSQL sorts NULLs first on
  a descending sort and an unscored candidate must not outrank a scored one.
- **A report is a recorded snapshot.** `POST /screening/jobs/:jobId/reports` renders the same
  payload and inserts a `generated_reports` row with the format, file name, MIME type, byte size
  and SHA-256 `content_hash`; `storage_path` stays `NULL` because there is no storage provider, so
  the bytes are returned to the caller and the row is the audit trail that a report was produced
  from that batch at that time. `GET .../reports` lists metadata only.
- **Reports are not billed.** No `FeaturePricing` row or shared feature key exists for them: the
  per-CV `HRD_SCREEN_PER_CV` charge already paid for producing the result. Introducing a paid
  report means adding a feature key to `packages/shared` and the pricing table, never a literal in
  the service.
- **No migration was needed.** `generated_reports` and every column the payload reads already
  existed from Phase 3.

#### Integration evidence (Phase 16)

- **No migration was needed.** `integration_evidence_snapshots` (per user/provider/URL, with
  `status`, `payload`, `failure_reason`, `fetched_at`, `expires_at`) and `evidence_items` already
  existed; verified link summaries are stored as candidate-level evidence rows
  (`candidate_id` set, `criterion_result_id` `NULL`) so the results payload surfaces them as
  `githubEvidence` / `portfolioEvidence`.
- **Snapshots are a cache, not a claim.** A fresh snapshot (`expires_at` in the future and not
  `UNVERIFIED`) is reused without a fetch, so a second verification of the same link costs
  nothing. There is no unique key on `(user_id, provider, source_url)`, so the newest row for a
  URL is updated rather than upserted.
- **Statuses report corroboration, never dishonesty.** A fetched and summarised page is
  `SUPPORTED`; an unreadable page, a fetch failure and a self-reported LinkedIn link stay
  `UNVERIFIED`; a CV with no links stays `NOT_CHECKED`. `CONFLICTING_INFORMATION` is not produced
  yet, because nothing compares a specific CV claim with the page.
- **Re-running verification replaces its own evidence** (`evidence_items` with `criterion_result_id`
  `NULL` and source `GITHUB`/`PORTFOLIO` are cleared first), so repeated checks do not stack rows.
- **`EVIDENCE_VERIFICATION` is priced per candidate.** One hold is taken before the first fetch and
  settled for one unit only when at least one page was actually verified; a run where every link
  failed (or the page had no readable text) releases the whole hold.

#### Testimonials (Phase 17)

- **No migration was needed.** `testimonials` already carried `status`, `rating`, `comment`,
  `display_name`, `enhancement_id`, `moderated_by_user_id` and `moderated_at`.
- **The public read is filtered in SQL** (`status = 'APPROVED'`), not in the service, so a
  pending or rejected review cannot leak through a forgotten filter; the moderation queue is the
  only reader that sees every status.
- **Moderation leaves a trail.** Approving or rejecting writes `moderated_by_user_id` and
  `moderated_at`, and re-moderating simply moves the row to the new status with the latest
  moderator - there is no separate history table.
- **`display_name` is author-chosen or the profile name.** It is never derived from the account
  email, and the public payload omits the status entirely.
- **One review per enhancement.** `enhancement_id` is a soft link (`ON DELETE SET NULL`) and is
  not unique in the schema, so the service refuses a second review for the same enhancement
  (a real unique index would need a migration).

#### Admin reporting (Phase 18)

- **No migration was needed.** Everything the console reports is derived from existing tables:
  `users`, `credit_wallets`, `credit_transactions`, `payment_transactions`,
  `payment_webhook_events`, `ai_usage_records`, `screening_jobs`, `screening_candidates`,
  `testimonials` and `feature_pricing`.
- **The aggregates are reads, not a materialised dashboard.** Credit inflow/outflow comes from
  `credit_transactions` over a 30-day window, so the console can never disagree with the ledger;
  provider cost and margin come from `ai_usage_records`.
- **Price changes are an audited override.** `FeaturePricing.updatedByUserId` records the admin
  who changed a price, and the shared defaults remain the fallback when no row exists.
- **A manual credit adjustment is an `ADJUSTMENT` ledger entry** (`reference_type =
'admin_adjustment'`, `reference_id` = the admin's user id), written through the same
  transaction that enforces `balance >= reserved >= 0` - the console has no direct wallet write.
- **Role changes are a single-column update** guarded by `requireAdmin`, with self-demotion
  refused so the last admin cannot lock the console.

### Social proof

| Model         | Table          | Purpose                                                                      |
| ------------- | -------------- | ---------------------------------------------------------------------------- |
| `Testimonial` | `testimonials` | Post-enhancement rating/comment, moderated by an admin before it can appear. |

`testimonials.status` defaults to `PENDING`; only `APPROVED` rows are rendered publicly.

---

## 3. Enums

20 PostgreSQL enums back the state machines so invalid states are rejected by the
database, not just by TypeScript.

| Enum                    | Values                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `UserRole`              | `USER`, `ADMIN`                                                                                                          |
| `AuthProvider`          | `PASSWORD`, `GOOGLE`                                                                                                     |
| `CvDocumentKind`        | `ORIGINAL`, `ENHANCED`                                                                                                   |
| `CvAnalysisKind`        | `FREE_AUDIT`, `DEEP_ANALYSIS`                                                                                            |
| `EnhancementStatus`     | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `REFUNDED`                                                               |
| `ScreeningJobState`     | `CREATED`, `VALIDATING`, `QUEUED`, `PROCESSING`, `PARTIALLY_COMPLETED`, `COMPLETED`, `FAILED`, `CANCELLED`               |
| `CandidateState`        | `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`                                                                            |
| `RequirementClass`      | `REQUIRED`, `PREFERRED`, `BONUS`                                                                                         |
| `ScoringCategory`       | `EXPERIENCE`, `TECHNICAL_SKILLS`, `PROJECTS`, `EDUCATION`, `PORTFOLIO`, `OTHER`                                          |
| `EvidenceStatus`        | `FOUND`, `NOT_FOUND`, `UNCERTAIN`                                                                                        |
| `VerificationStatus`    | `VERIFIED_EVIDENCE`, `SUPPORTED`, `UNVERIFIED`, `CONFLICTING_INFORMATION`, `NOT_CHECKED`                                 |
| `EligibilityStatus`     | `HIGH_MATCH`, `CONSIDER`, `LOW_MATCH`, `REQUIREMENT_NOT_MET`                                                             |
| `EvidenceSource`        | `CV`, `GITHUB`, `PORTFOLIO`, `LINKEDIN_SELF_REPORTED`, `USER_INPUT`, `JOB_DESCRIPTION`                                   |
| `CreditTransactionType` | `TOP_UP`, `RESERVATION`, `RESERVATION_RELEASE`, `USAGE`, `REFUND`, `ADJUSTMENT`                                          |
| `ReservationState`      | `ACTIVE`, `SETTLED`, `RELEASED`, `EXPIRED`                                                                               |
| `PaymentStatus`         | `CREATED`, `PENDING`, `PAID`, `PROCESSING`, `COMPLETED`, `FAILED`, `EXPIRED`, `REFUNDED`                                 |
| `TestimonialStatus`     | `PENDING`, `APPROVED`, `REJECTED`                                                                                        |
| `ReportFormat`          | `PDF`, `CSV`                                                                                                             |
| `IntegrationProvider`   | `GITHUB`, `PORTFOLIO`, `LINKEDIN`                                                                                        |
| `ScreeningJobEventType` | `STATE_CHANGED`, `CANDIDATE_QUEUED`, `CANDIDATE_COMPLETED`, `CANDIDATE_FAILED`, `CANDIDATE_RETRIED`, `PROGRESS`, `ERROR` |

Notes:

- `EligibilityStatus` values are **workflow classifications**, never judgements about a
  person. `REQUIREMENT_NOT_MET` candidates stay in the results.
- `VerificationStatus` deliberately avoids `FAKE` / `LIAR` / `FRAUD`. Absence of evidence
  is not evidence of dishonesty.

---

## 4. Ledger invariants (the important part)

Credits are the product's money. The rules below are enforced by the credit repository
and service inside database transactions.

1. **One wallet per user**, created lazily on first use (`credit_wallets.user_id` unique).
2. **Invariant** `balance >= reserved >= 0` at all times. A user can only spend
   `available = balance - reserved`.
3. **Every mutation is atomic.** `CreditRepository.applyDelta` performs a single
   conditional `UPDATE` whose `WHERE` clause includes the affordability guard, so two
   concurrent requests can never both pass a stale check:

   ```sql
   UPDATE credit_wallets
      SET balance = balance + $delta,
          reserved = reserved + $reservedDelta
    WHERE id = $walletId
      AND balance + $delta >= 0
      AND balance + $delta >= reserved + $reservedDelta
   ```

   Zero rows updated ⇒ not affordable ⇒ `INSUFFICIENT_CREDITS`, raised before anything
   else changes.

4. **Every balance change writes one ledger row** (`credit_transactions`) with
   `amount`, `balance_before`, `balance_after`, `type`, an optional `feature`, and a
   human-readable `description`. Balances are never updated without a ledger row.
5. **Idempotency.** `credit_transactions.idempotency_key` and
   `credit_reservations.idempotency_key` are unique. A repeated top-up reference or
   settle/release call returns the existing row instead of double-applying.
6. **Estimate → reserve → execute → settle.** Expensive operations reserve the maximum
   cost first, then settle with the real charge (`settled_credits <= reserved_credits`)
   and release the remainder. A failure before billable usage releases everything.
7. **Never negative due to concurrency.** There is no SQL `CHECK` constraint for the
   invariant — it is enforced in the guarded `UPDATE` above (which is the concurrency
   guard) and covered by `tests/credit-ledger.test.ts`.
8. **Reservations are stateful**: `ACTIVE → SETTLED | RELEASED | EXPIRED`. Only `ACTIVE`
   rows count toward `wallet.reserved`.

Batch screening follows the same path: preflight estimate → single reservation for
`candidates × HRD_SCREEN_PER_CV` → per-candidate settlement → release of unused credits.
A batch therefore cannot run out of credits half-way through.

### Payments and top-up settlement

A top-up is a `payment_transactions` row whose lifecycle is
`CREATED → PENDING → PAID → COMPLETED`, with `FAILED`, `EXPIRED` and `REFUNDED` as
terminal alternatives. `completed_at` is set exactly once, when the credits exist.

Rules the schema and the service enforce together:

1. **Checkout creates a PENDING row first.** `payment.service.checkout` resolves the
   amount from shared configuration (`TOPUP_PACKAGES`, `MIN_TOPUP_IDR`,
   `CREDIT_IDR_VALUE` — never literals), inserts the row, and only then asks the
   provider for a payment instrument. No credits move at checkout.
2. **Only a verified notification settles.** `providers/payments/*.verifyWebhook`
   validates the provider signature (`sha512(order_id + status_code + gross_amount +
server_key)` for Midtrans) and returns a normalised payload; an unsigned or tampered
   call is rejected with `403 FORBIDDEN` and is not even recorded.
3. **Signature, amount and state are all checked.** The service drops the notification
   with `IGNORED` when the order is unknown, the provider differs, or
   `payload.amountIdr !== payment.amount_idr`. A `FAILED`/`EXPIRED` notification can never
   downgrade a `COMPLETED` payment.
4. **Idempotent by construction.** `payment_webhook_events.event_key` is unique
   (a redelivery is stored once and answered `DUPLICATE`), and the ledger grant uses
   `idempotency_key = payment:<payment_transaction_id>`, so credits can never be granted
   twice for one payment.
5. **The ledger is the only balance mutation.** Settlement calls
   `creditService.grantTopUp`, which writes the `TOP_UP` `credit_transactions` row inside
   the same transaction that increases the wallet (see the credit-economy rules above).
6. **Expiry never credits.** Overdue `PENDING` rows become `EXPIRED`
   (`PaymentService.expireOverdue`, also applied lazily on user reads). A later _signed_
   settlement is still honoured, because a raw expiry timestamp is a local guess while a
   signature-verified settlement is authoritative.
7. **Refunds are recorded, not auto-reversed.** A `REFUNDED` notification only moves a
   `COMPLETED` payment to `REFUNDED`; reversing credits is an audited admin adjustment
   (Phase 18), never an automatic side effect.

`PAYMENT_PROVIDER=mock` is the default, so the whole flow (including the signed mock
webhook and `POST /api/payments/:id/simulate`) runs offline. Midtrans is prepared behind the
same interface but is never auto-activated.

### Feature pricing

- Defaults live in `packages/shared/src/constants/credit-pricing.ts`
  (`DEFAULT_FEATURE_PRICING`). `feature_pricing` may override a subset.
- Defaults: `FREE_CV_AUDIT` 0, `CV_DEEP_ANALYSIS` 2, `CV_ENHANCEMENT` 5,
  `CV_REGENERATE` 3, `CV_PDF_EXPORT` 1, `EVIDENCE_VERIFICATION` 2,
  `HRD_SCREEN_PER_CV` 1.
- `PricingService` caches overrides for 30 seconds (invalidated on write) and merges them
  over the defaults. No component or controller hardcodes a credit cost.

### AI usage vs. user pricing

`ai_usage_records` stores provider, model, token counts, `estimated_cost_usd`,
`target_revenue_usd` (= cost × `AI_MARKUP_MULTIPLIER`) and `credits_charged`. This is
**internal margin monitoring only** — users are charged the feature price, never a token
cost.

`prompt_version` on `ai_usage_records`, `cv_analyses` and `cv_enhancements` records which
versioned runtime prompt produced the call or the stored result, so historical rows stay
auditable after a prompt changes (architecture: `docs/AI_PROMPTS.md`). The column is nullable:
rows written before the versioned prompt layer, or features not yet migrated to it, keep
`NULL`. Only the version id is stored — never the system-prompt text and never in a
user-facing response.

---

## 5. Indexes

Indexes exist for the three access patterns that matter: owner history lists, state
queues, and idempotency lookups.

| Index                                                                                         | Why                                                      |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `credit_transactions(wallet_id, created_at)`, `(user_id, created_at)`, `(type)`, `(feature)`  | Ledger history pages, admin aggregation by type/feature. |
| `credit_reservations(wallet_id, state)`, `(user_id, state)`, `(reference_type, reference_id)` | Active-hold queries and release-by-reference.            |
| `payment_transactions(user_id, created_at)`, `(status)`, `(provider_transaction_id)`          | User payment history, reconciliation, status sweeps.     |
| `payment_webhook_events(provider, received_at)`, `(processed)`                                | Replay audits and retry of unprocessed events.           |
| `cv_documents(user_id, created_at)`, `(text_hash)`                                            | User document history; duplicate-text lookup.            |
| `cv_analyses(user_id, created_at)`, `cv_enhancements(user_id, created_at)`, `(status)`        | History views and enhancement queues.                    |
| `screening_jobs(user_id, created_at)`, `(state)`                                              | Recruiter history and the worker's job queue.            |
| `screening_candidates(job_id, state)`, `(job_id, score)`                                      | Progress polling (`n / total`) and ranked result pages.  |
| `evidence_items(candidate_id)`, `(criterion_result_id)`                                       | Evidence fetch per candidate/criterion.                  |
| `screening_job_events(job_id, created_at)`, `(type, created_at)`                              | Job timeline and admin failed-job views.                 |
| `testimonials(status, created_at)`                                                            | Landing page lists only `APPROVED`, newest first.        |
| `users(role)`, `(created_at)`                                                                 | Admin user list and growth charts.                       |

Uniqueness is also a safety mechanism: `users.email`,
`auth_identities(provider, provider_user_id)`, `credit_wallets.user_id`,
`payment_transactions.order_id`, `payment_webhook_events.event_key`,
`screening_requirements(job_id, sort_order)`,
`screening_criterion_results(candidate_id, requirement_id)`,
`recruiter_preference_versions(user_id, version)`.

---

## 6. Referential integrity and retention

Foreign keys use `ON DELETE CASCADE` for data owned by a user or job (identities, wallet,
ledger, payments, CVs, screening batches and their candidates/criteria/evidence, events)
and `ON DELETE SET NULL` where a historical record must outlive its referrer
(`generated_reports.created_by_user_id`, moderator references, enhancement document
links, `feature_pricing.updated_by_user_id`).

Privacy rules that shape the schema (see `docs/SECURITY.md`):

| Data                        | Retention                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Anonymous free-audit upload | No `cv_documents` row; extracted text is used in memory and discarded.                                           |
| Authenticated CV text       | Stored in `cv_documents.text_content` with `user_id`; removable via soft delete that also clears `text_content`. |
| Screening candidate CV text | Stored in `screening_candidates.cv_text` for the recruiter's batch; cascades when the job is deleted.            |
| Generated reports           | Metadata always; the file itself may live in Supabase Storage (`storage_path`) or be generated on demand.        |
| Payments                    | Permanent (accounting/audit), including webhook payloads.                                                        |
| AI provider cost            | Permanent aggregate (`ai_usage_records`), no CV text stored there.                                               |

Full CV text must never be written to application logs.

---

## 7. Migrations

```bash
npm run gen          # prisma generate (rebuild the typed client)
npm run db:migrate   # prisma migrate dev  (local/dev, uses DIRECT_URL || DATABASE_URL)
npm run db:deploy    # prisma migrate deploy (applies pending migrations, e.g. Supabase/CI)
npm run db:studio    # prisma studio
```

Rules:

1. **Never edit an applied migration.** After the first real deployment, migrations are
   additive: add a new folder with a new timestamp.
2. The initial migration `20260926000000_init` was regenerated before any deployment, so
   it is still editable until the first `db:deploy` against a shared database.
3. Migrations run against `DIRECT_URL` when present. Pooled connections cannot always run
   DDL reliably.
4. `tests/database-schema.test.ts` runs
   `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` and fails
   if the output differs from the committed migration, so schema edits without a
   migration are caught in CI.
5. Destructive operations (`migrate reset`, dropping columns/tables) are never run
   automatically against a remote database. They require an explicit human decision.
6. `tests/migrate-deploy.test.ts` runs `prisma migrate deploy` against a
   PostgreSQL-wire server, so a broken migration folder or config is caught in CI.

---

## 8. Testing

- Integration tests run against **real PostgreSQL semantics** via PGlite over the
  PostgreSQL wire protocol (`apps/api/tests/helpers/db.ts`); the committed migration SQL
  is applied verbatim. No Docker required.
- **PGlite is the only supported test database today.** Earlier documents (and the harness's own
  error message) mentioned a `TEST_DATABASE_URL` fallback to a real PostgreSQL instance; that
  variable is _not implemented_. Running the suites therefore requires permission to bind a local
  socket - a normal shell or a CI runner has it, a restricted sandbox does not
  (`PROJECT_CONTEXT.md` §8.4, §8.47).
- Restore a clean database between tests with `ctx.db.reset()` (truncate + `RESTART
IDENTITY ... CASCADE`).
- Current database-focused suites: `db-harness.test.ts` (engine + migration smoke),
  `database-schema.test.ts` (drift/parity/index/constraint guards),
  `cv-repository.test.ts` (document lifecycle + cascades),
  `pricing-repository.test.ts` (override persistence + default fallback),
  `credit-ledger.test.ts` (ledger concurrency and reservation lifecycle),
  `migrate-deploy.test.ts` (the real `prisma migrate deploy` CLI end to end),
  `screening-batch.test.ts` (batch upload: partial success, ZIP guards, credit hold),
  `screening-queue-flow.test.ts` (queue: retries, batch outcome, settlement, idempotency, cancel),
  `screening-evidence.test.ts` (grounding, the audit envelope and the provider round trip),
  `scoring-engine.test.ts` (the pure scoring rule set, including re-scoring expectations),
  `screening-results-api.test.ts` (results payload, CSV/PDF reports, report history),
  `screening-report-template.test.ts` (report escaping, CSV shape and file names),
  `portfolio-verification.test.ts` (link extraction, snapshots, per-candidate settlement),
  `http-guards.test.ts` (the SSRF address/host/content rules),
  `testimonials-api.test.ts` (submission, public filtering, admin moderation, one-per-enhancement).
  `admin-api.test.ts` (admin authorization, dashboard aggregates, price override, ledger-routed
  adjustment, reporting lists).
- `migrate-deploy.test.ts` boots a PostgreSQL-wire server, runs the actual
  `prisma migrate deploy` binary against it, and asserts the migration is applied and
  recorded in `_prisma_migrations` (23 application tables + the history table). This
  covers the deployment code path - migration checksums, the history table and
  `prisma.config.ts` URL wiring - not just the raw SQL.
- Still unverified: a live Supabase instance (no credentials in this environment, and the
  sandbox blocks outbound network). The owner must run `npm run db:deploy` once against
  the real project before the first deployment.
