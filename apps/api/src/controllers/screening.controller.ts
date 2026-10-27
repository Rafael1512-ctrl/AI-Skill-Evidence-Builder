import type { Request, Response } from 'express';

import type {
  CreateScreeningJobInput,
  PaginationQuery,
  RecruiterPreferences,
  ScreeningReportRequest,
} from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.js';
import { recruiterPreferenceService } from '../services/recruiter-preference.service.js';
import { screeningBatchService } from '../services/screening-batch.service.js';
import { portfolioVerificationService } from '../services/portfolio-verification.service.js';
import { screeningReportService } from '../services/screening-report.service.js';
import { screeningService } from '../services/screening.service.js';
import { AppError } from '../utils/errors.js';

/** GET /api/screening/preferences - current recruiter preferences (version 0 = defaults). */
export async function getPreferences(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const preference = await recruiterPreferenceService.get(auth.userId);
  res.json({ data: { preference } });
}

/** PUT /api/screening/preferences - saves a new immutable version. */
export async function savePreferences(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const body = validatedBody<RecruiterPreferences>(req);
  const preference = await recruiterPreferenceService.save(auth.userId, body);
  res.json({ data: { preference } });
}

/** GET /api/screening/preferences/versions - the audit trail of saved versions. */
export async function listPreferenceVersions(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const query = validatedQuery<PaginationQuery>(req);

  const result = await recruiterPreferenceService.listVersions({
    userId: auth.userId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: result,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

/** POST /api/screening/jobs - creates a job in CREATED with its frozen requirements. */
export async function createJob(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const body = validatedBody<CreateScreeningJobInput>(req);

  const job = await screeningService.createJob(auth.userId, body);
  res.status(201).json({ data: { job } });
}

/** GET /api/screening/jobs - the caller's own screening jobs, newest first. */
export async function listJobs(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const query = validatedQuery<PaginationQuery>(req);

  const result = await screeningService.listJobs({
    userId: auth.userId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: result,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

/** GET /api/screening/jobs/:jobId */
export async function getJob(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);

  const job = await screeningService.getJob(auth.userId, jobId);
  res.json({ data: { job } });
}

/** PATCH /api/screening/jobs/:jobId - cancels a job that has not finished. */
export async function updateJobState(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);
  validatedBody<{ state: 'CANCELLED' }>(req);

  const job = await screeningService.cancelJob(auth.userId, jobId);
  res.json({ data: { job } });
}

/** GET /api/screening/jobs/:jobId/progress */
export async function getProgress(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);

  const progress = await screeningService.progress(auth.userId, jobId);
  res.json({ data: { progress } });
}

/**
 * POST /api/screening/jobs/:jobId/candidates
 *
 * Uploads a batch of up to 50 PDFs, or one ZIP, as multipart field `files`. Individual
 * files that fail validation come back in `rejected`; the accepted ones are stored as
 * `QUEUED` and their credits are reserved.
 */
export async function uploadCandidates(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);

  const files = req.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw AppError.validation({ field: 'files' }, 'Tidak ada berkas CV yang diunggah.');
  }

  const batch = await screeningBatchService.uploadCandidates(auth.userId, jobId, files);
  res.status(201).json({ data: { batch } });
}

/** GET /api/screening/jobs/:jobId/candidates - the uploaded batch, oldest first. */
export async function listCandidates(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);
  const query = validatedQuery<PaginationQuery>(req);

  const candidates = await screeningBatchService.listCandidates({
    userId: auth.userId,
    jobId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: { candidates },
    meta: { page: candidates.page, pageSize: candidates.pageSize, total: candidates.total },
  });
}

/**
 * GET /api/screening/jobs/:jobId/results
 *
 * The scored, ranked batch with its evidence. Nothing is recomputed here: the stored
 * criterion results and scores are the source of truth.
 */
export async function getScreeningResults(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);

  const results = await screeningReportService.getResults(auth.userId, jobId);
  res.json({ data: { results } });
}

/** POST /api/screening/jobs/:jobId/reports - renders a CSV/PDF snapshot of the results. */
export async function exportScreeningReport(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);
  const body = validatedBody<ScreeningReportRequest>(req);

  const report = await screeningReportService.exportReport({
    userId: auth.userId,
    jobId,
    format: body.format,
  });

  res.status(201).json({ data: { report } });
}

/** GET /api/screening/jobs/:jobId/reports - the report history for a job. */
export async function listScreeningReports(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);
  const query = validatedQuery<PaginationQuery>(req);

  const reports = await screeningReportService.listReports({
    userId: auth.userId,
    jobId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: { reports },
    meta: { page: reports.page, pageSize: reports.pageSize, total: reports.total },
  });
}

/**
 * POST /api/screening/jobs/:jobId/candidates/:candidateId/verification
 *
 * Checks the links a CV contains (GitHub / portfolio; LinkedIn is recorded as self-reported
 * and never fetched) through the SSRF-guarded fetcher, stores the snapshots and
 * candidate-level evidence, and settles `EVIDENCE_VERIFICATION` once per candidate when at
 * least one page was actually summarised.
 */
export async function verifyCandidateEvidence(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId, candidateId } = validatedParams<{ jobId: string; candidateId: string }>(req);

  const verification = await portfolioVerificationService.verifyCandidate({
    userId: auth.userId,
    jobId,
    candidateId,
  });

  res.status(201).json({ data: { verification } });
}

/**
 * GET /api/screening/jobs/:jobId/verification/estimate
 *
 * The preflight for the bulk action: how many candidates would be verified and what the
 * server-resolved total would cost, so the price is visible before anything is spent.
 */
export async function getVerificationEstimate(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);

  const estimate = await portfolioVerificationService.planVerification({
    userId: auth.userId,
    jobId,
  });

  res.json({ data: { estimate } });
}

/**
 * POST /api/screening/jobs/:jobId/verification
 *
 * Verifies every eligible candidate of the job once: already-verified candidates are skipped,
 * a CV still being processed is not touched, and the whole cost is reserved before the first
 * fetch, so an unaffordable batch fails as a whole instead of starting partially.
 */
export async function verifyCandidates(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { jobId } = validatedParams<{ jobId: string }>(req);

  const verification = await portfolioVerificationService.verifyCandidates({
    userId: auth.userId,
    jobId,
  });

  res.status(201).json({ data: { verification } });
}
