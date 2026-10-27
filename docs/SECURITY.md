# Security and privacy

> Owned by Phase 19. It describes what the system protects, which controls exist today, and
> which risks are knowingly accepted. Every control below names the code that implements it so a
> reviewer can check the claim instead of trusting this file.

## 1. Assets

| Asset                                | Why it matters                                                         |
| ------------------------------------ | ---------------------------------------------------------------------- |
| CV contents and extracted text       | Sensitive personal data, including data about people who never signed up |
| Account identity and sessions        | Takeover would expose a wallet, history and screening results           |
| Credit balances and the ledger       | Money. Every change must be attributable and balances can never go negative |
| Payment transactions and webhooks    | Forged events would mint credits                                        |
| Screening results and reports        | A recruiter's confidential hiring material                              |
| Provider credentials (`DEEPSEEK_*`, `MIDTRANS_*`, `SUPABASE_SERVICE_ROLE_KEY`) | Cost and account compromise          |

## 2. Threat model

**Untrusted data, never instructions.** CV text, ZIP entry names, fetched web pages and URLs are
attacker-controlled. They are parsed, bounded and treated as data:

- Prompt layers put untrusted documents last and delimited (`utils/text.ts` `wrapUntrusted`), and
  the mock provider reads only inside those delimiters, so tests exercise the real boundary
  (`tests/prompt-builder.test.ts`, `tests/evidence-extraction-prompt.test.ts`).
- ZIP batches are bounded before anything is read: entry count, total uncompressed size,
  compression ratio, per-entry ceiling, encrypted entries and OS metadata
  (`utils/zip.ts`, `tests/zip.test.ts`).
- PDFs are accepted by magic number, not by extension or declared MIME type, and text extraction is
  bounded (`utils/file-validation.ts`, `services/pdf-extraction.service.ts`).
- Report and CV templates escape every interpolated value and render with a strict CSP and
  JavaScript disabled (`templates/cv/html.ts`, `tests/screening-report-template.test.ts`).

**SSRF.** A candidate-supplied URL is attacker-chosen, so outbound fetches go through
`providers/http/guards.ts`: http(s) only, internal hostnames refused, **every** resolved address
checked (loopback, private, link-local, CGNAT, cloud metadata, multicast, reserved, IPv4-mapped
forms), each redirect hop re-validated (max 3), a hard timeout and a byte cap, and a content-type
allowlist. DNS rebinding is defeated by checking resolved addresses rather than the hostname.
LinkedIn is never fetched. Guards run in both the `guarded` and `mock` providers; only the
`guarded` one touches the network (`tests/http-guards.test.ts`).

**Authentication and authorization.** Supabase JWTs are verified against the project's JWKS
(issuer + audience); the dev HS256 strategy is disabled in production
(`config/env.ts` refuses `AUTH_DEV_MODE=true` outside development). Roles are re-read from the
database per request, so a stale or forged claim changes nothing
(`middleware/auth.ts`, `tests/admin-authorization.test.ts`). Ownership is enforced in the
services: another user's job, candidate, enhancement or payment is answered with `404`,
indistinguishable from missing (`tests/screening-api.test.ts`, `tests/payments-api.test.ts`).
`requireAdmin` is mounted once on `/api/admin/*`, so a new admin route cannot ship unguarded.

**Payments.** Webhooks are signature-verified, amount-checked, archived in
`PaymentWebhookEvent` with a unique `event_key`, and credits are granted only through the ledger
with the idempotency key `payment:<id>`: a replayed delivery is a no-op and a payment cannot credit
twice (`tests/payment-provider.test.ts`, `tests/payments-api.test.ts`). The Midtrans adapter is
prepared but never auto-activated.

**Money and the ledger.** Balances move only inside a database transaction in
`CreditRepository.applyDeltaWithLedger`, which enforces `balance >= reserved >= 0`. Reservations
are taken before expensive work and settled for what was delivered, so a failed or partial batch
is never charged (`tests/credit-ledger.test.ts`, `tests/screening-queue-flow.test.ts`). The admin
adjustment path goes through the same service and writes an `ADJUSTMENT` row referencing the admin
who did it.

**Model output.** Every provider method validates its response against a shared Zod schema before
any business logic sees it; a validation failure is a typed error, never a partial write. Evidence
quotes are grounded against the stored source and can only be downgraded, never upgraded
(`utils/evidence.ts`). The model never scores: `services/scoring/engine.ts` is pure and its rules
are versioned (`SCORING_ENGINE_VERSION`).

**Abuse.** Fixed-window rate limits cover the generic API surface, the development credential
routes, the guest audit (per IP), profile linking and testimonial submission (per account, 5 per
day). Every limiter carries its own counter namespace (`rateLimit({ scope })`): they share one
store, so an unscoped limiter would count the same bucket as the generic API surface and the
strictest limit would reject unrelated traffic (`PROJECT_CONTEXT.md` §8.62). Counters live behind
`RateLimitStore`, which is process-local by default and **shared through Redis when `REDIS_URL` is
set** - without that, each replica would allow the full quota. A store outage fails open with a
logged warning (see §4).

**Data exposure.** Responses are Zod-shaped and omit extracted CV text from list endpoints;
`GET /screening/jobs/:id/candidates` never returns `cv_text`. Logs redact authorization headers,
cookies, webhook signatures, tokens, CV text and provider keys centrally
(`utils/logger.ts`). Admin lists return no credential material.

## 3. Privacy

- Anonymous audits are processed in memory and are not persisted.
- Signed-in CV text is stored because the product needs it (enhancement, screening evidence,
  reproducibility); users can delete a stored document, which cascades.
- Screening batches belong to the recruiter's account and are scoped to it on every read.
- The AI never infers protected attributes, and no feature uses them for scoring or summaries
  (`prompts/global/*`, `docs/AI_PROMPTS.md` §11).
- `AiUsageRecord` exists for provider-cost analysis only and is never surfaced to end users.

## 4. Accepted risks

| Risk                                                                 | Why it is accepted today                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Rate limiting fails open when its store is unreachable                | Availability first; the failure is logged as a warning. Documented, not silent.                             |
| No second admin role tier (read-only/support)                         | A schema change; until then admin is all-or-nothing (`PROJECT_CONTEXT.md` §8.42).                           |
| Exported PDFs and reports are streamed, only metadata is stored       | No storage provider yet; the row keeps size + SHA-256 so an export is auditable (§8.31).                    |
| Verification statuses do not cross-check a specific CV claim          | `CONFLICTING_INFORMATION` would need claim extraction + matching (§8.34).                                   |
| In-process queue when `REDIS_URL` is unset                            | Single-container MVP; the same switch that shares rate limits enables the BullMQ driver.                     |
| The guarded fetcher has never run against the real internet in tests  | No outbound network in the build environment; DNS/redirect/size logic is unit-tested (§8.36).                |
| Pre-existing web test failures in three page suites                   | Unrelated to features and tracked (§8.15); the API and the other web suites are green.                        |

## 5. Production checklist

1. `NODE_ENV=production` and `AUTH_DEV_MODE=false` (the API refuses to boot otherwise).
2. Supabase: asymmetric JWT signing key active, `SUPABASE_URL` + `SUPABASE_ANON_KEY` set, the
   browser mirrors in `VITE_*`. `SUPABASE_SERVICE_ROLE_KEY` stays server-side and is never
   prefixed `VITE_`.
3. Database: `DATABASE_URL` uses the transaction pooler with `?sslmode=no-verify`;
   `DIRECT_URL` uses the session pooler with `?sslmode=verify-full`. Run `npm run db:deploy` once
   and only ever add migrations thereafter.
4. Secrets: `DEEPSEEK_API_KEY`, `MIDTRANS_SERVER_KEY` and the payment webhook secret come from the
   platform's secret store, never from the repository; rotate them by replacing the value and
   restarting, and never log them (redaction is central but not a licence to print them).
5. Payments: keep `PAYMENT_PROVIDER=mock` until the Midtrans dashboard is configured, its
   notification URL points at `/api/payments/webhook/midtrans`, and one signed
   sandbox notification has been replayed to prove idempotency. **The owner has Midtrans sandbox
   credentials**; the first live check is: set `MIDTRANS_SERVER_KEY` + `MIDTRANS_CLIENT_KEY` from
   the secret store (never the repository), switch `PAYMENT_PROVIDER=midtrans`, pay one sandbox
   top-up, confirm the ledger credits exactly once, then replay the same notification and confirm
   it is recorded as a duplicate no-op. Rotate the sandbox keys before using production ones.
6. `REDIS_URL` set, so rate limits are shared and the queue runs out of process
   (`npm run start:worker`).
7. `OUTBOUND_HTTP_PROVIDER=guarded` if link verification is wanted; leave `mock` to disable
   outbound traffic entirely. `PORTFOLIO_VERIFICATION_ENABLED=false` disables the feature.
8. `CORS_EXTRA_ORIGINS` contains only real front-end origins; the allowlist rejects everything
   else.
9. Audit the first week: `/api/admin/overview` (failure rate, credits outstanding), webhook events
   with `signatureValid=false`, and `failed-candidates` reasons.

## 6. Reporting a problem

Security issues must not be filed as public issues. Report privately to the project owner with the
affected endpoint, a minimal reproduction, and whether data, credits or credentials are involved.
Do not test against other people's accounts or CVs.
