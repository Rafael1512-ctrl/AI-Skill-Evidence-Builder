# API contract

> Owned by Phase 15, extended by later phases. Route/controller comments remain the
> source of truth for edge cases; this file is the map.

Base path: `/api`. The API is same-origin behind the Vite dev proxy; the browser never
needs an absolute URL.

## Envelope and errors

Success:

```json
{ "data": { "...": "payload" }, "meta": { "page": 1, "pageSize": 20, "total": 42 } }
```

`meta` only appears on paginated endpoints. Failure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Data yang dikirim tidak valid.",
    "details": [{ "where": "body", "path": "title", "message": "..." }],
    "requestId": "…"
  }
}
```

- Codes and HTTP statuses live in `packages/shared/src/constants/error-codes.ts`.
- `requestId` is echoed from `x-request-id` (or generated) and appears in the logs, so a
  user-reported failure can be traced without leaking internals.
- Messages are Bahasa Indonesia and safe to show. Internal faults are logged and reduced
  to a generic message (a developer hint is added in development only).

## Authentication

`Authorization: Bearer <token>`. Two authorities, chosen by configuration, never by
runtime chance (`PROJECT_CONTEXT.md` §6):

- **Supabase** (production): the browser keeps the session in the SDK and the API verifies
  the access token against the project's JWKS (issuer `<SUPABASE_URL>/auth/v1`, audience
  `authenticated`).
- **Dev HS256** (`AUTH_DEV_MODE=true`): `POST /auth/dev/sign-up` and `/auth/dev/sign-in`
  issue a local token for development and tests.

`requireAuth` returns `401` with `AUTHENTICATION_REQUIRED`; `requireAdmin` returns `403`
`FORBIDDEN`. Role checks read the stored user row, never the token claims.

## Endpoints

### Health

| Method | Path      | Auth | Notes                          |
| ------ | --------- | ---- | ------------------------------ |
| GET    | `/health` | –    | Liveness plus configuration    |

### Auth and profile

| Method | Path                    | Auth      | Notes                                                  |
| ------ | ----------------------- | --------- | ------------------------------------------------------ |
| POST   | `/auth/dev/sign-up`     | –         | Dev only; refused when `AUTH_DEV_MODE=false`            |
| POST   | `/auth/dev/sign-in`     | –         | Dev only                                                |
| GET    | `/auth/me`              | session   | Idempotent account flags for the browser                |
| GET    | `/profile`              | session   | Profile plus Google-link state                          |
| PATCH  | `/profile`              | session   | Partial update; email/role are not writable             |
| POST   | `/profile/google/connect` | session | Preflight for SDK-side identity linking                 |

### CV (job seeker)

| Method | Path                                       | Auth      | Credits             |
| ------ | ------------------------------------------ | --------- | ------------------- |
| GET    | `/cv/test`                                 | –         | 0                   |
| GET    | `/cv/templates`                            | –         | 0                   |
| POST   | `/cv/audit`                                | optional  | 0 (guests included) |
| GET    | `/cv/history`                              | session   | 0                   |
| POST   | `/cv/enhance`                              | session   | `CV_ENHANCEMENT`    |
| GET    | `/cv/enhancements/:enhancementId`          | session   | 0                   |
| POST   | `/cv/enhancements/:enhancementId/export`   | session   | `CV_PDF_EXPORT`     |
| GET    | `/cv/analyses/:analysisId`                 | session   | 0                   |
| DELETE | `/cv/documents/:documentId`                | session   | 0                   |

Uploads are `multipart/form-data`. The audit is rate-limited per IP for guests.

### Credits and payments

| Method | Path                              | Auth    | Notes                                               |
| ------ | --------------------------------- | ------- | --------------------------------------------------- |
| GET    | `/credits/pricing`                | –       | Effective prices (defaults + admin overrides)        |
| GET    | `/credits/packages`               | –       | Top-up packages                                     |
| GET    | `/credits/wallet`                 | session | Balance, reserved, available                        |
| GET    | `/credits/transactions`           | session | Paginated ledger                                    |
| POST   | `/credits/estimate`               | session | Preflight cost for a feature                        |
| POST   | `/payments/checkout`              | session | Creates a `PENDING` transaction and an instrument    |
| GET    | `/payments`                       | session | Owner-scoped payment list                           |
| GET    | `/payments/:paymentId`            | session | Owner-scoped payment detail                         |
| POST   | `/payments/:paymentId/simulate`   | session | Drives the mock provider through the real webhook   |
| POST   | `/payments/webhook/mock`          | –       | HMAC-verified, idempotent                           |
| POST   | `/payments/webhook/midtrans`      | –       | Signature-verified, idempotent, never auto-activated |

Balances only move through the ledger inside a database transaction; balances never go
negative. A repeated webhook delivery is a no-op (`PaymentWebhookEvent.event_key`).

### Screening (recruiter)

| Method | Path                                  | Auth    | Notes                                                    |
| ------ | ------------------------------------- | ------- | -------------------------------------------------------- |
| GET    | `/screening/preferences`              | session | Version 0 = shared defaults, never saved                  |
| PUT    | `/screening/preferences`              | session | Writes a new immutable version snapshot                   |
| GET    | `/screening/preferences/versions`     | session | Audit trail of saved versions                             |
| POST   | `/screening/jobs`                     | session | Creates a job in `CREATED`, freezing all four versions     |
| GET    | `/screening/jobs`                     | session | Own jobs, newest first                                    |
| GET    | `/screening/jobs/:jobId`              | session | Detail plus requirements                                  |
| PATCH  | `/screening/jobs/:jobId`              | session | Cancel only; releases the credit hold                     |
| GET    | `/screening/jobs/:jobId/progress`     | session | Polled by the UI while a batch runs                       |
| POST   | `/screening/jobs/:jobId/candidates`   | session | Batch upload: ≤50 PDFs or one ZIP (`files`), `HRD_SCREEN_PER_CV` per accepted CV |
| GET    | `/screening/jobs/:jobId/candidates`   | session | Batch metadata; never returns `cv_text`                   |
| GET    | `/screening/jobs/:jobId/results`      | session | Ranked results with per-criterion evidence                |
| POST   | `/screening/jobs/:jobId/reports`      | session | Renders `{ "format": "CSV" \| "PDF" }`, not billed separately |
| GET    | `/screening/jobs/:jobId/reports`      | session | Report history (metadata only)                            |
| POST   | `/screening/jobs/:jobId/candidates/:candidateId/verification` | session | Checks the links a CV contains (GitHub/portfolio; LinkedIn never fetched), `EVIDENCE_VERIFICATION` once per verified candidate |
| GET    | `/screening/jobs/:jobId/verification/estimate` | session | Bulk preflight: server-resolved `unitCredits`, eligible/in-progress/already-verified/no-link counts, total plus balance and shortfall |
| POST   | `/screening/jobs/:jobId/verification` | session | Bulk verification: one hold for the whole eligible set, settled for the candidates whose page was actually fetched |

**Verification credits.** `EVIDENCE_VERIFICATION` is priced per candidate and resolved
server-side from the `packages/shared` defaults plus any `FeaturePricing` override; the browser
never sends a price, it only mirrors `GET /credits/pricing` for the disclosure text. Both the
individual and the bulk endpoint take the hold before the first fetch and settle once afterwards,
so an already-`SUPPORTED` candidate or a reused snapshot cannot be charged twice and a replayed
request is a no-op. The bulk preflight is all-or-nothing: an unaffordable batch answers
`402 INSUFFICIENT_CREDITS` before any page is fetched, and the unused part of the hold is released
in the same atomic settlement that charges the delivered candidates.

### Testimonials

| Method | Path                                    | Auth    | Notes                                                        |
| ------ | --------------------------------------- | ------- | ------------------------------------------------------------ |
| GET    | `/testimonials`                         | –       | Approved only, newest first; the public shape has no status    |
| POST   | `/testimonials`                         | session | Creates a `PENDING` review; optional `enhancementId` must be the caller's own completed enhancement, reviewable once |
| GET    | `/testimonials/mine`                    | session | The caller's own reviews, status included                      |
| GET    | `/testimonials/moderation`              | admin   | Moderation queue, optionally filtered by `status`              |
| PATCH  | `/testimonials/:testimonialId/moderation` | admin | `APPROVED` or `REJECTED`; records the moderator and the time   |

`displayName` falls back to the profile name and never to the account email.

### Admin

Every route below is guarded once by `requireAuth()` + `requireAdmin()` on the router: the role
is re-read from the database per request, so a stale or forged token claim changes nothing.

| Method | Path                                        | Notes                                                        |
| ------ | ------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/admin/overview`                           | Dashboard aggregates (users, credits, revenue, AI cost/margin, screening, testimonials, system) plus the effective price list |
| GET    | `/admin/users`                              | Paginated users with wallet balances; `search` and `role` filters |
| GET    | `/admin/transactions`                       | System-wide ledger                                            |
| GET    | `/admin/payments`                           | Every payment attempt                                         |
| GET    | `/admin/webhook-events`                     | Deliveries, including rejected signatures and processing errors |
| GET    | `/admin/ai-usage`                           | Provider cost and margin (internal; never user-facing)         |
| GET    | `/admin/jobs`                               | Screening jobs with their owner                                |
| GET    | `/admin/failed-candidates`                  | Failed candidates with the reason and attempt count            |
| PUT    | `/admin/pricing/:feature`                   | Credit-price override through the pricing service; records who changed it |
| PATCH  | `/admin/users/:userId/role`                 | Grant/revoke the admin role; self-demotion is refused (409)    |
| POST   | `/admin/users/:userId/credits`              | Ledger-routed `ADJUSTMENT`; a balance can never go negative    |

Scoping is by ownership: another recruiter's job is answered with `404`, indistinguishable
from a missing one. See `docs/DATABASE.md` and `docs/AI_PROMPTS.md` for the pipeline behind
these routes.

## Contracts

Every request body, query and response is validated with the Zod schemas in
`packages/shared/src/schemas/*`, which the browser reuses, so a contract change fails both
sides at once. Uploads are treated as untrusted bytes: the file signature decides the type,
never the extension or the declared MIME type.
