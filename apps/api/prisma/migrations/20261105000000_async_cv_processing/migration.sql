-- CreateEnum
CREATE TYPE "CvAuditJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CvAuditMode" AS ENUM ('FREE', 'PAID');

-- AlterTable
ALTER TABLE "cv_analyses" ADD COLUMN "audit_job_id" TEXT;

-- CreateTable
CREATE TABLE "cv_audit_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT,
    "status" "CvAuditJobStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "CvAuditMode" NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "free_audits_used" INTEGER NOT NULL,
    "paid_audit_credits" INTEGER NOT NULL,
    "resets_at" TIMESTAMP(3) NOT NULL,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "cv_audit_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cv_analyses_audit_job_id_key" ON "cv_analyses"("audit_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "cv_audit_jobs_reservation_id_key" ON "cv_audit_jobs"("reservation_id");

-- CreateIndex
CREATE INDEX "cv_audit_jobs_user_id_created_at_idx" ON "cv_audit_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "cv_audit_jobs_status_idx" ON "cv_audit_jobs"("status");

-- AddForeignKey
ALTER TABLE "cv_audit_jobs" ADD CONSTRAINT "cv_audit_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_audit_jobs" ADD CONSTRAINT "cv_audit_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "cv_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_analyses" ADD CONSTRAINT "cv_analyses_audit_job_id_fkey" FOREIGN KEY ("audit_job_id") REFERENCES "cv_audit_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
