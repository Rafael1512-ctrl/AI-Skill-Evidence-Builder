import { z } from 'zod';

import {
  EVIDENCE_SOURCES,
  EVIDENCE_STATUSES,
  ELIGIBILITY_STATUSES,
  REPORT_FORMATS,
  REQUIREMENT_CLASSES,
  SCREENING_CANDIDATE_STATES,
  SCREENING_JOB_STATES,
  SCORING_CATEGORIES,
  VERIFICATION_STATUSES,
} from '../constants/workflow.js';
import {
  REQUIREMENT_WEIGHT_MAX,
  REQUIREMENT_WEIGHT_MIN,
  DEFAULT_REQUIREMENT_WEIGHT,
} from '../constants/scoring.js';
import { LIMITS } from '../constants/limits.js';
import { errorCodeSchema, shortTextSchema } from './common.js';

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

export const screeningRequirementInputSchema = z.object({
  text: z.string().trim().min(3).max(300),
  category: z.enum(SCORING_CATEGORIES).default('OTHER'),
  requirementClass: z.enum(REQUIREMENT_CLASSES).default('REQUIRED'),
  weight: z
    .number()
    .int()
    .min(REQUIREMENT_WEIGHT_MIN)
    .max(REQUIREMENT_WEIGHT_MAX)
    .default(DEFAULT_REQUIREMENT_WEIGHT),
  hardRequirement: z.boolean().default(false),
});

export type ScreeningRequirementInput = z.infer<typeof screeningRequirementInputSchema>;

const categoryWeightsShape = z.record(z.enum(SCORING_CATEGORIES), z.number().min(0).max(100));

/**
 * Category weights are optional. When supplied they must total exactly 100:
 * an invalid total is rejected rather than silently renormalised.
 */
export const categoryWeightsSchema = categoryWeightsShape
  .refine(
    (weights) => {
      const values = Object.values(weights);
      if (values.length === 0) return true;
      const total = values.reduce((sum, value) => sum + value, 0);
      return Math.abs(total - 100) < 0.001;
    },
    { message: 'Total bobot kategori harus tepat 100.' },
  )
  .refine((weights) => Object.values(weights).every((value) => value >= 0), {
    message: 'Bobot tidak boleh negatif.',
  });

export type CategoryWeights = z.infer<typeof categoryWeightsShape>;

/* -------------------------------------------------------------------------- */
/* Recruiter preferences (versioned)                                           */
/* -------------------------------------------------------------------------- */

export const recruiterPreferencesSchema = z.object({
  preferredSkills: z
    .array(z.string().trim().min(1).max(80))
    .max(LIMITS.MAX_PREFERENCE_ITEMS)
    .default([]),
  experiencePriorities: z
    .array(z.string().trim().min(1).max(200))
    .max(LIMITS.MAX_PREFERENCE_ITEMS)
    .default([]),
  educationPreferences: z
    .array(z.string().trim().min(1).max(200))
    .max(LIMITS.MAX_PREFERENCE_ITEMS)
    .default([]),
  portfolioImportance: z.number().int().min(0).max(100).default(50),
  projectPreferences: z
    .array(z.string().trim().min(1).max(200))
    .max(LIMITS.MAX_PREFERENCE_ITEMS)
    .default([]),
  defaultWeights: categoryWeightsSchema.optional(),
  screeningNotes: z.string().trim().max(2000).default(''),
});

export type RecruiterPreferences = z.infer<typeof recruiterPreferencesSchema>;

export const DEFAULT_RECRUITER_PREFERENCES: RecruiterPreferences = {
  preferredSkills: [],
  experiencePriorities: [],
  educationPreferences: [],
  portfolioImportance: 50,
  projectPreferences: [],
  screeningNotes: '',
};

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export const evidenceItemSchema = z.object({
  /** Short snippet copied from the source, never a long dumped section. */
  quote: z.string().min(1).max(LIMITS.MAX_EVIDENCE_QUOTE_CHARS),
  source: z.enum(EVIDENCE_SOURCES),
  page: z.number().int().min(1).nullable().default(null),
  url: z.string().max(2048).nullable().default(null),
  note: z.string().max(300).nullable().default(null),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

/** Exactly what the AI must return per criterion. */
export const criterionEvidenceSchema = z.object({
  requirementId: z.string().min(1).max(64),
  status: z.enum(EVIDENCE_STATUSES),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.array(evidenceItemSchema).max(5).default([]),
  notes: z.string().max(600).default(''),
});

export type CriterionEvidence = z.infer<typeof criterionEvidenceSchema>;

export const screeningEvidenceResponseSchema = z.object({
  criteria: z.array(criterionEvidenceSchema).default([]),
  candidateName: z.string().max(200).nullable().default(null),
  summary: z.string().max(1500).default(''),
  gaps: z.array(z.string().max(400)).max(20).default([]),
  uncertainties: z.array(z.string().max(400)).max(20).default([]),
});

export type ScreeningEvidenceResponse = z.infer<typeof screeningEvidenceResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Stored, deterministic results                                               */
/* -------------------------------------------------------------------------- */

export const criterionResultSchema = z.object({
  requirementId: z.string(),
  criterion: z.string(),
  category: z.enum(SCORING_CATEGORIES),
  requirementClass: z.enum(REQUIREMENT_CLASSES),
  weight: z.number(),
  normalisedWeight: z.number(),
  hardRequirement: z.boolean(),
  status: z.enum(EVIDENCE_STATUSES),
  verificationStatus: z.enum(VERIFICATION_STATUSES).default('NOT_CHECKED'),
  confidence: z.number().min(0).max(1),
  earnedScore: z.number().min(0).max(100),
  evidence: z.array(evidenceItemSchema).default([]),
  notes: z.string().default(''),
});

export type CriterionResult = z.infer<typeof criterionResultSchema>;

export const candidateResultSchema = z.object({
  candidateId: z.string(),
  candidateName: z.string(),
  /** Uploaded file name, so a report row can be traced back to the batch entry. */
  fileName: z.string(),
  processingStatus: z.enum(SCREENING_CANDIDATE_STATES),
  score: z.number().min(0).max(100).nullable(),
  eligibilityStatus: z.enum(ELIGIBILITY_STATUSES).nullable(),
  criteriaResults: z.array(criterionResultSchema).default([]),
  requiredCriteria: z.array(criterionResultSchema).default([]),
  preferredCriteria: z.array(criterionResultSchema).default([]),
  bonusCriteria: z.array(criterionResultSchema).default([]),
  evidence: z.array(evidenceItemSchema).default([]),
  strengths: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  unmetHardRequirements: z.array(z.string()).default([]),
  portfolioEvidence: z.array(evidenceItemSchema).default([]),
  githubEvidence: z.array(evidenceItemSchema).default([]),
  verificationStatus: z.enum(VERIFICATION_STATUSES).default('NOT_CHECKED'),
  summary: z.string().default(''),
  generatedAt: z.string(),
  scoringConfigurationVersion: z.string(),
  preferenceVersion: z.number().int().min(0),
  failureReason: z.string().nullable().default(null),
});

export type CandidateResult = z.infer<typeof candidateResultSchema>;

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

export const createScreeningJobSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(20).max(20_000),
  requirements: z.array(screeningRequirementInputSchema).min(1).max(40),
  categoryWeights: categoryWeightsSchema.optional(),
  screeningNotes: z.string().trim().max(2000).optional(),
  /** Freeze the recruiter's current preference version into this job. */
  useRecruiterPreferences: z.boolean().default(true),
});

export type CreateScreeningJobInput = z.infer<typeof createScreeningJobSchema>;

/**
 * What a client sends for a job draft, before the schema defaults fill in the category,
 * class, weight and hard-requirement flags. The API still validates it.
 */
export type CreateScreeningJobRequest = z.input<typeof createScreeningJobSchema>;

export const screeningJobStateUpdateSchema = z.object({
  state: z.enum(['CANCELLED']),
});

export const screeningJobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.enum(SCREENING_JOB_STATES),
  totalCandidates: z.number().int().min(0),
  queuedCandidates: z.number().int().min(0),
  processingCandidates: z.number().int().min(0),
  completedCandidates: z.number().int().min(0),
  failedCandidates: z.number().int().min(0),
  creditsReserved: z.number().int().min(0),
  creditsCharged: z.number().int().min(0),
  categoryWeights: z.record(z.string(), z.number()).nullable(),
  scoringConfigurationVersion: z.string(),
  preferenceVersion: z.number().int().min(0),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type ScreeningJobSummary = z.infer<typeof screeningJobSummarySchema>;

export const screeningProgressSchema = z.object({
  jobId: z.string(),
  state: z.enum(SCREENING_JOB_STATES),
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  processing: z.number().int().min(0),
  queued: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  partialSuccess: z.boolean(),
  finished: z.boolean(),
});

export type ScreeningProgress = z.infer<typeof screeningProgressSchema>;

export const screeningResultPayloadSchema = z.object({
  job: screeningJobSummarySchema,
  methodologyNote: z.string(),
  candidates: z.array(candidateResultSchema),
});

export type ScreeningResultPayload = z.infer<typeof screeningResultPayloadSchema>;

export const screeningJobIdParamSchema = z.object({ jobId: shortTextSchema });
export const screeningCandidateParamSchema = z.object({
  jobId: shortTextSchema,
  candidateId: shortTextSchema,
});

/* -------------------------------------------------------------------------- */
/* Batch upload (Phase 11)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A single file that could not be accepted into the batch.
 *
 * `code` reuses the shared error vocabulary so the UI can render the same message
 * style as a top-level API error without a second taxonomy.
 */
export const screeningBatchRejectionSchema = z.object({
  fileName: z.string(),
  code: errorCodeSchema,
  message: z.string(),
});

export type ScreeningBatchRejection = z.infer<typeof screeningBatchRejectionSchema>;

/**
 * One uploaded CV inside a screening job.
 *
 * The extracted CV text is deliberately not part of the wire format: it is sensitive
 * candidate data and only used server-side for evidence extraction (Phase 13).
 */
export const screeningCandidateSummarySchema = z.object({
  id: z.string(),
  candidateName: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().min(0),
  state: z.enum(SCREENING_CANDIDATE_STATES),
  attempts: z.number().int().min(0),
  pageCount: z.number().int().min(0),
  score: z.number().min(0).max(100).nullable(),
  eligibilityStatus: z.enum(ELIGIBILITY_STATUSES).nullable(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScreeningCandidateSummary = z.infer<typeof screeningCandidateSummarySchema>;

/**
 * Partial-success batch upload result.
 *
 * The batch itself is rejected as a whole (4xx) only when the archive or the request is
 * unusable; individual files that fail validation come back in `rejected` while the rest
 * are accepted and queued.
 */
export const screeningBatchUploadResultSchema = z.object({
  job: screeningJobSummarySchema,
  accepted: z.array(screeningCandidateSummarySchema),
  rejected: z.array(screeningBatchRejectionSchema),
  acceptedCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  creditsReserved: z.number().int().min(0),
  reservationId: z.string().nullable(),
});

export type ScreeningBatchUploadResult = z.infer<typeof screeningBatchUploadResultSchema>;

export const screeningCandidateListSchema = z.object({
  items: z.array(screeningCandidateSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type ScreeningCandidateList = z.infer<typeof screeningCandidateListSchema>;

/* -------------------------------------------------------------------------- */
/* Stored evidence (Phase 13)                                                  */
/* -------------------------------------------------------------------------- */

/** What grounding did to the model's quotes before they were stored. */
export const evidenceGroundingSummarySchema = z.object({
  droppedQuotes: z.number().int().min(0),
  downgradedCriteria: z.number().int().min(0),
  /**
   * Page citations cannot be verified yet: the batch stores the joined CV text without its
   * per-page breakdown, so no page number is persisted.
   */
  pageVerification: z.literal('unavailable'),
});

export type EvidenceGroundingSummary = z.infer<typeof evidenceGroundingSummarySchema>;

/**
 * What `ScreeningCandidate.analysis_json` holds after evidence extraction.
 *
 * It records the versions that produced the result *together with* the grounded evidence,
 * so a single candidate row stays auditable without a join. Scoring (Phase 14) reads this
 * envelope; the API never returns it raw because it contains model output.
 */
export const candidateEvidenceEnvelopeSchema = z.object({
  promptVersion: z.string(),
  preferenceVersion: z.number().int().min(0),
  scoringConfigurationVersion: z.string(),
  requirementVersion: z.number().int().min(1),
  provider: z.string(),
  model: z.string(),
  processedAt: z.iso.datetime(),
  grounding: evidenceGroundingSummarySchema,
  evidence: screeningEvidenceResponseSchema,
});

export type CandidateEvidenceEnvelope = z.infer<typeof candidateEvidenceEnvelopeSchema>;

/* -------------------------------------------------------------------------- */
/* Portfolio / integration evidence (Phase 16)                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a fetched public page may contribute.
 *
 * `inconclusive` exists so "the page was unreadable" can never be dressed up as a finding -
 * and the summary is text from a model that was told to add nothing of its own.
 */
export const portfolioSummaryResponseSchema = z.object({
  title: z.string().max(200).nullable().default(null),
  summary: z.string().max(1_500).default(''),
  apparentSkills: z.array(z.string().max(80)).max(30).default([]),
  projectHints: z.array(z.string().max(200)).max(30).default([]),
  inconclusive: z.boolean().default(false),
});

export type PortfolioSummaryResponse = z.infer<typeof portfolioSummaryResponseSchema>;

/** One link that was checked (or deliberately not fetched, like a self-reported LinkedIn). */
export const linkVerificationSchema = z.object({
  url: z.string().max(2048),
  source: z.enum(EVIDENCE_SOURCES),
  status: z.enum(VERIFICATION_STATUSES),
  summary: z.string().max(1_500).default(''),
  inconclusive: z.boolean().default(false),
  /** True when a cached snapshot was reused, so no fetch and no credit were spent. */
  fromCache: z.boolean().default(false),
  failureReason: z.string().max(300).nullable().default(null),
});

export type LinkVerification = z.infer<typeof linkVerificationSchema>;

/**
 * The outcome of verifying one candidate's links.
 *
 * `verificationStatus` summarises the whole candidate: `SUPPORTED` means at least one page
 * was fetched and summarised, `UNVERIFIED` means the links exist but nothing could be
 * confirmed, `NOT_CHECKED` means no link was found (or verification is switched off). It is
 * never a statement that the candidate lied.
 */
export const candidateVerificationResultSchema = z.object({
  candidateId: z.string(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  links: z.array(linkVerificationSchema).default([]),
  creditsCharged: z.number().int().min(0).default(0),
  disabled: z.boolean().default(false),
});

export type CandidateVerificationResult = z.infer<typeof candidateVerificationResultSchema>;

export const candidateVerificationResponseSchema = z.object({
  verification: candidateVerificationResultSchema,
});

export type CandidateVerificationResponse = z.infer<typeof candidateVerificationResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Bulk verification (preflight + execution)                                   */
/* -------------------------------------------------------------------------- */

/** A candidate the bulk action would verify. Names only; no CV content leaves the server. */
export const verificationCandidateRefSchema = z.object({
  candidateId: z.string(),
  candidateName: z.string(),
});

export type VerificationCandidateRef = z.infer<typeof verificationCandidateRefSchema>;

/**
 * The server's preflight answer for a bulk verification.
 *
 * The browser never decides the price or the candidate set: `unitCredits` comes from the
 * centralized pricing service (default plus any admin override) and `eligibleCount` counts
 * exactly the candidates the server would charge for - completed, not already `SUPPORTED`,
 * and exposing at least one fetchable link. The excluded counts are reported so the UI can
 * explain why a candidate is not part of the total.
 */
export const screeningVerificationEstimateSchema = z.object({
  feature: z.string(),
  /** True when the deployment has switched verification off; nothing can be charged then. */
  disabled: z.boolean().default(false),
  /** Resolved unit price for one candidate; never trusted from the request body. */
  unitCredits: z.number().int().min(0),
  /** Candidates that would be charged: `unitCredits * eligibleCount`. */
  eligibleCount: z.number().int().min(0),
  totalCredits: z.number().int().min(0),
  /** Excluded: a page was already fetched and summarised, so a repeat would be a no-op. */
  alreadyVerifiedCount: z.number().int().min(0),
  /** Excluded: the CV is still queued/processing, or its extraction failed. */
  inProgressCount: z.number().int().min(0),
  /** Excluded: the CV exposes no fetchable link, so there is nothing to bill for. */
  noLinkCount: z.number().int().min(0),
  balance: z.number().int().min(0),
  reserved: z.number().int().min(0),
  available: z.number().int().min(0),
  sufficient: z.boolean(),
  shortfall: z.number().int().min(0),
  candidates: z.array(verificationCandidateRefSchema).default([]),
});

export type ScreeningVerificationEstimate = z.infer<typeof screeningVerificationEstimateSchema>;

export const screeningVerificationEstimateResponseSchema = z.object({
  estimate: screeningVerificationEstimateSchema,
});

export type ScreeningVerificationEstimateResponse = z.infer<
  typeof screeningVerificationEstimateResponseSchema
>;

/**
 * The outcome of one bulk verification.
 *
 * `creditsCharged` is what was actually settled (`unitCredits * verifiedCount`), which can be
 * lower than the preflight total when a page turned out to be unreachable - the unused hold is
 * released, never charged.
 */
export const bulkVerificationResultSchema = z.object({
  jobId: z.string(),
  feature: z.string(),
  unitCredits: z.number().int().min(0),
  eligibleCount: z.number().int().min(0),
  /** Candidates whose page was actually fetched and summarised - the billable ones. */
  verifiedCount: z.number().int().min(0),
  creditsCharged: z.number().int().min(0),
  results: z.array(candidateVerificationResultSchema).default([]),
});

export type BulkVerificationResult = z.infer<typeof bulkVerificationResultSchema>;

export const bulkVerificationResponseSchema = z.object({
  verification: bulkVerificationResultSchema,
});

export type BulkVerificationResponse = z.infer<typeof bulkVerificationResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Results and reports (Phase 15)                                              */
/* -------------------------------------------------------------------------- */

/**
 * The methodology note shipped with every result payload and report.
 *
 * Reviewers see this next to the scores, so the product states its own limits: the AI
 * reports evidence, the engine scores, and "not found" is never a claim about honesty.
 */
export const SCREENING_METHODOLOGY_NOTE = [
  'AI hanya mengekstrak bukti dari CV untuk setiap kriteria; skor dan peringkat dihitung',
  'mesin deterministik dan dapat direproduksi dari data yang tersimpan.',
  'NOT_FOUND berarti tidak ada bukti pendukung pada materi yang tersedia, bukan penilaian',
  'tentang kejujuran kandidat. UNCERTAIN berarti bukti ambigu sehingga tidak diberi nilai penuh.',
  'Kandidat yang tidak memenuhi syarat wajib (REQUIREMENT_NOT_MET) tetap ditampilkan, tidak',
  'disembunyikan.',
].join(' ');

export const screeningResultPayloadResponseSchema = z.object({
  results: screeningResultPayloadSchema,
});

export type ScreeningResultPayloadResponse = z.infer<typeof screeningResultPayloadResponseSchema>;

export const screeningReportRequestSchema = z.object({
  format: z.enum(REPORT_FORMATS),
});

export type ScreeningReportRequest = z.infer<typeof screeningReportRequestSchema>;

/** A stored report. `storagePath` is null while reports are generated on demand. */
export const screeningReportMetadataSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  format: z.enum(REPORT_FORMATS),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(0),
  contentHash: z.string().nullable(),
  createdAt: z.string(),
});

export type ScreeningReportMetadata = z.infer<typeof screeningReportMetadataSchema>;

/**
 * A freshly generated report.
 *
 * `contentBase64` carries the bytes inline, exactly like the CV export: without a storage
 * provider there is no signed URL to hand out, and keeping the bytes in the standard JSON
 * envelope means the same Zod contract covers both surfaces.
 */
export const screeningReportResultSchema = screeningReportMetadataSchema.extend({
  contentBase64: z.string().min(1),
  creditsCharged: z.number().int().min(0),
});

export type ScreeningReportResult = z.infer<typeof screeningReportResultSchema>;

export const screeningReportListSchema = z.object({
  items: z.array(screeningReportMetadataSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type ScreeningReportList = z.infer<typeof screeningReportListSchema>;

export const screeningReportResponseSchema = z.object({ report: screeningReportResultSchema });

export type ScreeningReportResponse = z.infer<typeof screeningReportResponseSchema>;

export const screeningReportListResponseSchema = z.object({ reports: screeningReportListSchema });

export type ScreeningReportListResponse = z.infer<typeof screeningReportListResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Stored shapes and API responses                                             */
/* -------------------------------------------------------------------------- */

/** A stored requirement as it comes back from the API. */
export const screeningRequirementSchema = z.object({
  id: z.string(),
  sortOrder: z.number().int().min(0),
  text: z.string(),
  category: z.enum(SCORING_CATEGORIES),
  requirementClass: z.enum(REQUIREMENT_CLASSES),
  weight: z.number().int(),
  hardRequirement: z.boolean(),
});

export type ScreeningRequirement = z.infer<typeof screeningRequirementSchema>;

/**
 * Full job detail.
 *
 * The four frozen versions travel together so a stored result stays reproducible:
 * preference, requirement, scoring configuration and runtime prompt.
 */
export const screeningJobDetailSchema = screeningJobSummarySchema.extend({
  description: z.string(),
  screeningNotes: z.string().nullable(),
  requirementVersion: z.number().int().min(1),
  promptVersion: z.string(),
  failureReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  updatedAt: z.string(),
  requirements: z.array(screeningRequirementSchema),
});

export type ScreeningJobDetail = z.infer<typeof screeningJobDetailSchema>;

export const screeningJobListSchema = z.object({
  items: z.array(screeningJobSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type ScreeningJobList = z.infer<typeof screeningJobListSchema>;

/**
 * The recruiter's current preferences plus the version counter.
 *
 * `version: 0` means "never saved": the immutable shared defaults were used and no
 * `RecruiterPreferenceVersion` snapshot exists for it.
 */
export const recruiterPreferenceSnapshotSchema = z.object({
  preferences: recruiterPreferencesSchema,
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});

export type RecruiterPreferenceSnapshot = z.infer<typeof recruiterPreferenceSnapshotSchema>;

/** One immutable preference snapshot, used to reproduce a historical screening. */
export const recruiterPreferenceVersionSchema = z.object({
  version: z.number().int().min(1),
  preferences: recruiterPreferencesSchema,
  createdAt: z.string(),
});

export type RecruiterPreferenceVersion = z.infer<typeof recruiterPreferenceVersionSchema>;

export const recruiterPreferenceVersionListSchema = z.object({
  items: z.array(recruiterPreferenceVersionSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type RecruiterPreferenceVersionList = z.infer<typeof recruiterPreferenceVersionListSchema>;

export const recruiterPreferenceResponseSchema = z.object({
  preference: recruiterPreferenceSnapshotSchema,
});

export type RecruiterPreferenceResponse = z.infer<typeof recruiterPreferenceResponseSchema>;

export const screeningJobResponseSchema = z.object({
  job: screeningJobDetailSchema,
});

export type ScreeningJobResponse = z.infer<typeof screeningJobResponseSchema>;

export const screeningProgressResponseSchema = z.object({
  progress: screeningProgressSchema,
});

export const screeningBatchUploadResponseSchema = z.object({
  batch: screeningBatchUploadResultSchema,
});

export type ScreeningBatchUploadResponse = z.infer<typeof screeningBatchUploadResponseSchema>;

export const screeningCandidateListResponseSchema = z.object({
  candidates: screeningCandidateListSchema,
});

export type ScreeningCandidateListResponse = z.infer<typeof screeningCandidateListResponseSchema>;

export type ScreeningProgressResponse = z.infer<typeof screeningProgressResponseSchema>;
