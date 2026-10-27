import { Router } from 'express';
import {
  createScreeningJobSchema,
  paginationQuerySchema,
  recruiterPreferencesSchema,
  screeningCandidateParamSchema,
  screeningReportRequestSchema,
  screeningJobIdParamSchema,
  screeningJobStateUpdateSchema,
} from '@aseb/shared';

import {
  createJob,
  exportScreeningReport,
  getJob,
  getPreferences,
  getProgress,
  getScreeningResults,
  getVerificationEstimate,
  listCandidates,
  listJobs,
  listPreferenceVersions,
  listScreeningReports,
  savePreferences,
  uploadCandidates,
  verifyCandidateEvidence,
  verifyCandidates,
  updateJobState,
} from '../controllers/screening.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadBatch } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

/**
 * Recruiter requirements.
 *
 * Both audiences share one account, so these routes require a session but not a special
 * role: the boundary that matters is ownership (`userId`), enforced in the service.
 */
export const screeningRouter = Router();

screeningRouter.get('/preferences', requireAuth(), getPreferences);
screeningRouter.put(
  '/preferences',
  requireAuth(),
  validate({ body: recruiterPreferencesSchema }),
  savePreferences,
);
screeningRouter.get(
  '/preferences/versions',
  requireAuth(),
  validate({ query: paginationQuerySchema }),
  listPreferenceVersions,
);

screeningRouter.post(
  '/jobs',
  requireAuth(),
  validate({ body: createScreeningJobSchema }),
  createJob,
);
screeningRouter.get('/jobs', requireAuth(), validate({ query: paginationQuerySchema }), listJobs);
screeningRouter.get(
  '/jobs/:jobId',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema }),
  getJob,
);
screeningRouter.patch(
  '/jobs/:jobId',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema, body: screeningJobStateUpdateSchema }),
  updateJobState,
);
screeningRouter.get(
  '/jobs/:jobId/progress',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema }),
  getProgress,
);

/**
 * Batch upload: up to 50 PDFs, or one ZIP, in the multipart field `files`.
 *
 * Multer runs first (it parses the multipart body), then the params are validated.
 */
screeningRouter.post(
  '/jobs/:jobId/candidates',
  requireAuth(),
  uploadBatch,
  validate({ params: screeningJobIdParamSchema }),
  uploadCandidates,
);
screeningRouter.get(
  '/jobs/:jobId/candidates',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema, query: paginationQuerySchema }),
  listCandidates,
);

/** Results and reports. Rendering a report is a snapshot, not a re-scoring. */
screeningRouter.get(
  '/jobs/:jobId/results',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema }),
  getScreeningResults,
);
screeningRouter.post(
  '/jobs/:jobId/reports',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema, body: screeningReportRequestSchema }),
  exportScreeningReport,
);
screeningRouter.get(
  '/jobs/:jobId/reports',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema, query: paginationQuerySchema }),
  listScreeningReports,
);

/** Evidence verification for one candidate: GitHub / portfolio links found in the CV. */
screeningRouter.post(
  '/jobs/:jobId/candidates/:candidateId/verification',
  requireAuth(),
  validate({ params: screeningCandidateParamSchema }),
  verifyCandidateEvidence,
);

/**
 * Bulk evidence verification for a whole job.
 *
 * `GET .../verification/estimate` is the preflight the UI shows before spending credits;
 * `POST .../verification` verifies every eligible candidate in one server-side action rather
 * than firing uncontrolled parallel per-candidate requests from the browser.
 */
screeningRouter.get(
  '/jobs/:jobId/verification/estimate',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema }),
  getVerificationEstimate,
);
screeningRouter.post(
  '/jobs/:jobId/verification',
  requireAuth(),
  validate({ params: screeningJobIdParamSchema }),
  verifyCandidates,
);
