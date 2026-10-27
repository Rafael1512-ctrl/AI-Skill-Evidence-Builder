-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('PASSWORD', 'GOOGLE');

-- CreateEnum
CREATE TYPE "CvDocumentKind" AS ENUM ('ORIGINAL', 'ENHANCED');

-- CreateEnum
CREATE TYPE "CvAnalysisKind" AS ENUM ('FREE_AUDIT', 'DEEP_ANALYSIS');

-- CreateEnum
CREATE TYPE "EnhancementStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ScreeningJobState" AS ENUM ('CREATED', 'VALIDATING', 'QUEUED', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CandidateState" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RequirementClass" AS ENUM ('REQUIRED', 'PREFERRED', 'BONUS');

-- CreateEnum
CREATE TYPE "ScoringCategory" AS ENUM ('EXPERIENCE', 'TECHNICAL_SKILLS', 'PROJECTS', 'EDUCATION', 'PORTFOLIO', 'OTHER');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('FOUND', 'NOT_FOUND', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED_EVIDENCE', 'SUPPORTED', 'UNVERIFIED', 'CONFLICTING_INFORMATION', 'NOT_CHECKED');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('HIGH_MATCH', 'CONSIDER', 'LOW_MATCH', 'REQUIREMENT_NOT_MET');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('CV', 'GITHUB', 'PORTFOLIO', 'LINKEDIN_SELF_REPORTED', 'USER_INPUT', 'JOB_DESCRIPTION');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('TOP_UP', 'RESERVATION', 'RESERVATION_RELEASE', 'USAGE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReservationState" AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TestimonialStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'CSV');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GITHUB', 'PORTFOLIO', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "ScreeningJobEventType" AS ENUM ('STATE_CHANGED', 'CANDIDATE_QUEUED', 'CANDIDATE_COMPLETED', 'CANDIDATE_FAILED', 'CANDIDATE_RETRIED', 'PROGRESS', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "full_name" TEXT,
    "headline" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "avatar_url" TEXT,
    "linkedin_url" TEXT,
    "github_url" TEXT,
    "portfolio_url" TEXT,
    "google_connected" BOOLEAN NOT NULL DEFAULT false,
    "has_password" BOOLEAN NOT NULL DEFAULT false,
    "github_username" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "password_salt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lifetime_credits_in" INTEGER NOT NULL DEFAULT 0,
    "lifetime_credits_spent" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "balance_before" INTEGER NOT NULL,
    "feature" TEXT,
    "description" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "idempotency_key" TEXT,
    "ai_usage_record_id" TEXT,
    "adjusted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_reservations" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "reserved_credits" INTEGER NOT NULL,
    "settled_credits" INTEGER,
    "state" "ReservationState" NOT NULL DEFAULT 'ACTIVE',
    "reference_type" TEXT,
    "reference_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "credit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_pricing" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6),
    "target_revenue_usd" DECIMAL(12,6),
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "screening_job_id" TEXT,
    "screening_candidate_id" TEXT,
    "cv_enhancement_id" TEXT,
    "latency_ms" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "provider_reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amount_idr" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "payment_url" TEXT,
    "qr_string" TEXT,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payment_transaction_id" TEXT,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cv_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" "CvDocumentKind" NOT NULL DEFAULT 'ORIGINAL',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "text_content" TEXT,
    "text_hash" TEXT,
    "is_ephemeral" BOOLEAN NOT NULL DEFAULT false,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cv_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cv_analyses" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "user_id" TEXT,
    "kind" "CvAnalysisKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT,
    "ats_score" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cv_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cv_enhancements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_document_id" TEXT,
    "result_document_id" TEXT,
    "status" "EnhancementStatus" NOT NULL DEFAULT 'PENDING',
    "options" JSONB NOT NULL,
    "document" JSONB,
    "template_key" TEXT NOT NULL DEFAULT 'ATS_MINIMAL',
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "reservation_id" TEXT,
    "prompt_version" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "cv_enhancements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "preferences" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruiter_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_preference_versions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "preferences" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruiter_preference_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "state" "ScreeningJobState" NOT NULL DEFAULT 'CREATED',
    "category_weights" JSONB,
    "screening_notes" TEXT,
    "scoring_configuration_version" TEXT NOT NULL,
    "preference_version" INTEGER NOT NULL,
    "requirement_version" INTEGER NOT NULL DEFAULT 1,
    "prompt_version" TEXT NOT NULL DEFAULT 'HRD_SCREENING_V1',
    "total_candidates" INTEGER NOT NULL DEFAULT 0,
    "completed_candidates" INTEGER NOT NULL DEFAULT 0,
    "failed_candidates" INTEGER NOT NULL DEFAULT 0,
    "credits_reserved" INTEGER NOT NULL DEFAULT 0,
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "reservation_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "screening_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_requirements" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "category" "ScoringCategory" NOT NULL DEFAULT 'OTHER',
    "requirementClass" "RequirementClass" NOT NULL DEFAULT 'REQUIRED',
    "weight" INTEGER NOT NULL DEFAULT 10,
    "hard_requirement" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_candidates" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "candidate_name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL DEFAULT 0,
    "state" "CandidateState" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cv_text" TEXT,
    "text_hash" TEXT,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "eligibility_status" "EligibilityStatus",
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "summary" TEXT,
    "gaps" JSONB,
    "uncertainties" JSONB,
    "strengths" JSONB,
    "analysis_json" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "screening_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_criterion_results" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "status" "EvidenceStatus" NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "confidence" DECIMAL(4,3) NOT NULL,
    "earned_score" DECIMAL(5,2) NOT NULL,
    "normalised_weight" DECIMAL(6,5) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_criterion_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "criterion_result_id" TEXT,
    "quote" TEXT NOT NULL,
    "source" "EvidenceSource" NOT NULL,
    "page" INTEGER,
    "url" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_evidence_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "source_url" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "payload" JSONB,
    "failure_reason" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "integration_evidence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" TEXT NOT NULL,
    "screening_job_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "format" "ReportFormat" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT,
    "storage_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_job_events" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "type" "ScreeningJobEventType" NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'PENDING',
    "enhancement_id" TEXT,
    "moderated_by_user_id" TEXT,
    "moderated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_user_id_key" ON "auth_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_user_id_key" ON "credit_wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_idempotency_key_key" ON "credit_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_transactions_wallet_id_created_at_idx" ON "credit_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_transactions_user_id_created_at_idx" ON "credit_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions"("type");

-- CreateIndex
CREATE INDEX "credit_transactions_feature_idx" ON "credit_transactions"("feature");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservations_idempotency_key_key" ON "credit_reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_reservations_wallet_id_state_idx" ON "credit_reservations"("wallet_id", "state");

-- CreateIndex
CREATE INDEX "credit_reservations_user_id_state_idx" ON "credit_reservations"("user_id", "state");

-- CreateIndex
CREATE INDEX "credit_reservations_reference_type_reference_id_idx" ON "credit_reservations"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_pricing_feature_key" ON "feature_pricing"("feature");

-- CreateIndex
CREATE INDEX "ai_usage_records_feature_created_at_idx" ON "ai_usage_records"("feature", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_created_at_idx" ON "ai_usage_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_model_created_at_idx" ON "ai_usage_records"("model", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_order_id_key" ON "payment_transactions"("order_id");

-- CreateIndex
CREATE INDEX "payment_transactions_user_id_created_at_idx" ON "payment_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "payment_transactions_provider_transaction_id_idx" ON "payment_transactions"("provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_event_key_key" ON "payment_webhook_events"("event_key");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_received_at_idx" ON "payment_webhook_events"("provider", "received_at");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processed_idx" ON "payment_webhook_events"("processed");

-- CreateIndex
CREATE INDEX "cv_documents_user_id_created_at_idx" ON "cv_documents"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "cv_documents_text_hash_idx" ON "cv_documents"("text_hash");

-- CreateIndex
CREATE INDEX "cv_analyses_user_id_created_at_idx" ON "cv_analyses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "cv_enhancements_user_id_created_at_idx" ON "cv_enhancements"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "cv_enhancements_status_idx" ON "cv_enhancements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_preferences_user_id_key" ON "recruiter_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_preference_versions_user_id_version_key" ON "recruiter_preference_versions"("user_id", "version");

-- CreateIndex
CREATE INDEX "screening_jobs_user_id_created_at_idx" ON "screening_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "screening_jobs_state_idx" ON "screening_jobs"("state");

-- CreateIndex
CREATE INDEX "screening_requirements_job_id_idx" ON "screening_requirements"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "screening_requirements_job_id_sort_order_key" ON "screening_requirements"("job_id", "sort_order");

-- CreateIndex
CREATE INDEX "screening_candidates_job_id_state_idx" ON "screening_candidates"("job_id", "state");

-- CreateIndex
CREATE INDEX "screening_candidates_job_id_score_idx" ON "screening_candidates"("job_id", "score");

-- CreateIndex
CREATE INDEX "screening_criterion_results_candidate_id_idx" ON "screening_criterion_results"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "screening_criterion_results_candidate_id_requirement_id_key" ON "screening_criterion_results"("candidate_id", "requirement_id");

-- CreateIndex
CREATE INDEX "evidence_items_candidate_id_idx" ON "evidence_items"("candidate_id");

-- CreateIndex
CREATE INDEX "evidence_items_criterion_result_id_idx" ON "evidence_items"("criterion_result_id");

-- CreateIndex
CREATE INDEX "integration_evidence_snapshots_user_id_provider_idx" ON "integration_evidence_snapshots"("user_id", "provider");

-- CreateIndex
CREATE INDEX "generated_reports_screening_job_id_format_idx" ON "generated_reports"("screening_job_id", "format");

-- CreateIndex
CREATE INDEX "screening_job_events_job_id_created_at_idx" ON "screening_job_events"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "screening_job_events_type_created_at_idx" ON "screening_job_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "testimonials_status_created_at_idx" ON "testimonials"("status", "created_at");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_adjusted_by_user_id_fkey" FOREIGN KEY ("adjusted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_pricing" ADD CONSTRAINT "feature_pricing_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_analyses" ADD CONSTRAINT "cv_analyses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "cv_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_analyses" ADD CONSTRAINT "cv_analyses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_enhancements" ADD CONSTRAINT "cv_enhancements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_enhancements" ADD CONSTRAINT "cv_enhancements_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "cv_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_enhancements" ADD CONSTRAINT "cv_enhancements_result_document_id_fkey" FOREIGN KEY ("result_document_id") REFERENCES "cv_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_preferences" ADD CONSTRAINT "recruiter_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_preference_versions" ADD CONSTRAINT "recruiter_preference_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_jobs" ADD CONSTRAINT "screening_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_jobs" ADD CONSTRAINT "screening_jobs_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "credit_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_requirements" ADD CONSTRAINT "screening_requirements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "screening_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_candidates" ADD CONSTRAINT "screening_candidates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "screening_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_criterion_results" ADD CONSTRAINT "screening_criterion_results_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "screening_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_criterion_results" ADD CONSTRAINT "screening_criterion_results_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "screening_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "screening_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_criterion_result_id_fkey" FOREIGN KEY ("criterion_result_id") REFERENCES "screening_criterion_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_evidence_snapshots" ADD CONSTRAINT "integration_evidence_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_screening_job_id_fkey" FOREIGN KEY ("screening_job_id") REFERENCES "screening_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_job_events" ADD CONSTRAINT "screening_job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "screening_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_moderated_by_user_id_fkey" FOREIGN KEY ("moderated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_enhancement_id_fkey" FOREIGN KEY ("enhancement_id") REFERENCES "cv_enhancements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
