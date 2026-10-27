import type {
  EligibilityStatus,
  EvidenceSource,
  EvidenceStatus,
  IntegrationProvider,
  IntegrationEvidenceSnapshot,
  VerificationStatus,
  Prisma,
  RecruiterPreference,
  RecruiterPreferenceVersion,
  ReportFormat,
  RequirementClass,
  ScoringCategory,
  ScreeningCandidate,
  ScreeningCriterionResult,
  EvidenceItem,
  GeneratedReport,
  ScreeningJob,
  ScreeningJobEventType,
  ScreeningRequirement,
} from '../generated/prisma/client.js';
import { Prisma as PrismaNamespace } from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';
import { AppError } from '../utils/errors.js';

export type ScreeningJobWithRequirements = ScreeningJob & {
  requirements: ScreeningRequirement[];
};

export interface CreateJobInput {
  userId: string;
  title: string;
  description: string;
  screeningNotes: string | null;
  categoryWeights: Record<string, number> | null;
  scoringConfigurationVersion: string;
  preferenceVersion: number;
  requirementVersion: number;
  promptVersion: string;
  requirements: ReadonlyArray<{
    text: string;
    category: ScoringCategory;
    requirementClass: RequirementClass;
    weight: number;
    hardRequirement: boolean;
  }>;
}

export interface CreateCandidateInput {
  candidateName: string;
  fileName: string;
  fileSizeBytes: number;
  cvText: string;
  textHash: string;
  pageCount: number;
}

export interface CreateCandidatesInput {
  jobId: string;
  candidates: readonly CreateCandidateInput[];
  reservationId: string;
  creditsReserved: number;
}

export interface FinalizeJobInput {
  jobId: string;
  state: ScreeningJob['state'];
  completedAt: Date;
  failureReason: string | null;
  creditsCharged: number;
  /** Human-readable reason recorded when the state actually changes. */
  message: string;
  progress: Record<string, number>;
}

export interface CandidateScoreWrite {
  candidateId: string;
  score: number;
  eligibilityStatus: EligibilityStatus;
  strengths: readonly string[];
  gaps: readonly string[];
  uncertainties: readonly string[];
  criteria: ReadonlyArray<{
    requirementId: string;
    status: EvidenceStatus;
    confidence: number;
    earnedScore: number;
    normalisedWeight: number;
    notes: string | null;
    evidence: ReadonlyArray<{
      quote: string;
      source: EvidenceSource;
      page: number | null;
      url: string | null;
      note: string | null;
    }>;
  }>;
}

/** JSON columns reject `undefined`; normalise to a JSON-safe value first. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Recruiter preference and screening job persistence.
 *
 * The only module that touches `recruiter_preferences*` and `screening_*`. Preference
 * writes are transactional: the current row is incremented and an immutable snapshot is
 * written together, so a job can always name the exact preferences it was built from.
 */
export class ScreeningRepository {
  /* ------------------------------------------------------------------ */
  /* Recruiter preferences                                              */
  /* ------------------------------------------------------------------ */

  async findPreference(userId: string): Promise<RecruiterPreference | null> {
    return getPrisma().recruiterPreference.findUnique({ where: { userId } });
  }

  /** Increments the version and stores the immutable snapshot in one transaction. */
  async upsertPreferenceWithSnapshot(input: {
    userId: string;
    preferences: unknown;
  }): Promise<{ preference: RecruiterPreference; snapshot: RecruiterPreferenceVersion }> {
    return getPrisma().$transaction(async (tx) => {
      const preference = await tx.recruiterPreference.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          version: 1,
          preferences: toJson(input.preferences),
        },
        update: {
          version: { increment: 1 },
          preferences: toJson(input.preferences),
        },
      });

      const snapshot = await tx.recruiterPreferenceVersion.create({
        data: {
          userId: input.userId,
          version: preference.version,
          preferences: toJson(preference.preferences),
        },
      });

      return { preference, snapshot };
    });
  }

  async listPreferenceVersions(input: {
    userId: string;
    skip: number;
    take: number;
  }): Promise<{ items: RecruiterPreferenceVersion[]; total: number }> {
    const [items, total] = await Promise.all([
      getPrisma().recruiterPreferenceVersion.findMany({
        where: { userId: input.userId },
        orderBy: { version: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().recruiterPreferenceVersion.count({ where: { userId: input.userId } }),
    ]);
    return { items, total };
  }

  /** The immutable snapshot a screening job recorded, so its context can be reproduced. */
  async findPreferenceVersion(input: {
    userId: string;
    version: number;
  }): Promise<RecruiterPreferenceVersion | null> {
    return getPrisma().recruiterPreferenceVersion.findUnique({
      where: { userId_version: { userId: input.userId, version: input.version } },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Screening jobs                                                     */
  /* ------------------------------------------------------------------ */

  async createJobWithRequirements(input: CreateJobInput): Promise<ScreeningJobWithRequirements> {
    const jobId = await getPrisma().$transaction(async (tx) => {
      const job = await tx.screeningJob.create({
        data: {
          userId: input.userId,
          title: input.title,
          description: input.description,
          state: 'CREATED',
          screeningNotes: input.screeningNotes,
          ...(input.categoryWeights ? { categoryWeights: toJson(input.categoryWeights) } : {}),
          scoringConfigurationVersion: input.scoringConfigurationVersion,
          preferenceVersion: input.preferenceVersion,
          requirementVersion: input.requirementVersion,
          promptVersion: input.promptVersion,
        },
      });

      await tx.screeningRequirement.createMany({
        data: input.requirements.map((requirement, index) => ({
          jobId: job.id,
          sortOrder: index + 1,
          text: requirement.text,
          category: requirement.category,
          requirementClass: requirement.requirementClass,
          weight: requirement.weight,
          hardRequirement: requirement.hardRequirement,
        })),
      });

      await tx.screeningJobEvent.create({
        data: {
          jobId: job.id,
          type: 'STATE_CHANGED',
          message: 'Screening job dibuat.',
          payload: toJson({ state: 'CREATED', requirementCount: input.requirements.length }),
        },
      });

      return job.id;
    });

    const job = await this.findJobById(jobId);
    if (!job) {
      throw AppError.internal(new Error(`Screening job ${jobId} missing right after creation`));
    }
    return job;
  }

  async findJobById(jobId: string): Promise<ScreeningJobWithRequirements | null> {
    return getPrisma().screeningJob.findUnique({
      where: { id: jobId },
      include: { requirements: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async listJobs(input: {
    userId: string;
    skip: number;
    take: number;
  }): Promise<{ items: ScreeningJob[]; total: number }> {
    const [items, total] = await Promise.all([
      getPrisma().screeningJob.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().screeningJob.count({ where: { userId: input.userId } }),
    ]);
    return { items, total };
  }

  /**
   * Stores an uploaded batch and moves its job into `QUEUED`.
   *
   * Candidates, the job counters, the credit reservation link and the audit events are
   * written in one transaction: a batch can never be half-recorded, and the job can never
   * claim a reservation that does not exist.
   */
  async createCandidatesForJob(input: CreateCandidatesInput): Promise<ScreeningCandidate[]> {
    return getPrisma().$transaction(async (tx) => {
      const created: ScreeningCandidate[] = [];

      for (const candidate of input.candidates) {
        const row = await tx.screeningCandidate.create({
          data: {
            jobId: input.jobId,
            candidateName: candidate.candidateName,
            fileName: candidate.fileName,
            fileSizeBytes: candidate.fileSizeBytes,
            state: 'QUEUED',
            cvText: candidate.cvText,
            textHash: candidate.textHash,
            pageCount: candidate.pageCount,
          },
        });
        created.push(row);

        await tx.screeningJobEvent.create({
          data: {
            jobId: input.jobId,
            type: 'CANDIDATE_QUEUED' satisfies ScreeningJobEventType,
            message: `Kandidat "${row.candidateName}" masuk antrean.`,
            payload: toJson({ candidateId: row.id, fileName: row.fileName }),
          },
        });
      }

      await tx.screeningJob.update({
        where: { id: input.jobId },
        data: {
          state: 'QUEUED',
          totalCandidates: { increment: created.length },
          reservationId: input.reservationId,
          creditsReserved: { increment: input.creditsReserved },
        },
      });

      await tx.screeningJobEvent.create({
        data: {
          jobId: input.jobId,
          type: 'STATE_CHANGED' satisfies ScreeningJobEventType,
          message: 'Batch kandidat diunggah dan masuk antrean.',
          payload: toJson({ state: 'QUEUED', candidateCount: created.length }),
        },
      });

      return created;
    });
  }

  async listCandidates(input: {
    jobId: string;
    skip: number;
    take: number;
  }): Promise<{ items: ScreeningCandidate[]; total: number }> {
    const [items, total] = await Promise.all([
      getPrisma().screeningCandidate.findMany({
        where: { jobId: input.jobId },
        // Every candidate of a batch is written in one transaction, so PostgreSQL's
        // `now()` gives them an identical `createdAt`: ordering by it would be arbitrary.
        // File name (plus `id` as a tie-breaker) keeps paging stable; the upload response
        // still returns the files in the order they were uploaded.
        orderBy: [{ fileName: 'asc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().screeningCandidate.count({ where: { jobId: input.jobId } }),
    ]);
    return { items, total };
  }

  /* ------------------------------------------------------------------ */
  /* Queue processing (Phase 12)                                        */
  /* ------------------------------------------------------------------ */

  async findCandidateWithJob(candidateId: string): Promise<
    | (ScreeningCandidate & {
        job: ScreeningJob & { requirements: ScreeningRequirement[] };
      })
    | null
  > {
    return getPrisma().screeningCandidate.findUnique({
      where: { id: candidateId },
      include: { job: { include: { requirements: { orderBy: { sortOrder: 'asc' } } } } },
    });
  }

  /**
   * Marks one attempt as started.
   *
   * `attempts` is incremented here rather than by a driver, so the counter is identical
   * whether the work ran through BullMQ, the in-process driver, or a retry after a crash.
   */
  async markCandidateProcessing(input: { candidateId: string; startedAt: Date }): Promise<void> {
    await getPrisma().screeningCandidate.update({
      where: { id: input.candidateId },
      data: {
        state: 'PROCESSING',
        startedAt: input.startedAt,
        attempts: { increment: 1 },
        failureReason: null,
      },
    });
  }

  async markCandidateQueuedForRetry(input: {
    candidateId: string;
    failureReason: string;
  }): Promise<void> {
    await getPrisma().screeningCandidate.update({
      where: { id: input.candidateId },
      data: { state: 'QUEUED', failureReason: input.failureReason },
    });
  }

  async markCandidateFinished(input: {
    candidateId: string;
    state: Extract<ScreeningCandidate['state'], 'COMPLETED' | 'FAILED'>;
    failureReason: string | null;
    completedAt: Date;
    /** Set when the extraction read a name from the CV itself. */
    candidateName?: string;
    /** Any JSON-serialisable worker output; serialised on write. */
    analysisJson?: unknown;
    summary?: string | null;
  }): Promise<void> {
    const data: Prisma.ScreeningCandidateUpdateInput = {
      state: input.state,
      failureReason: input.failureReason,
      completedAt: input.completedAt,
    };
    if (input.analysisJson !== undefined) {
      // A nullable Json column needs Prisma's explicit DB-null marker, not a plain `null`.
      data.analysisJson =
        input.analysisJson === null ? PrismaNamespace.DbNull : toJson(input.analysisJson);
    }
    if (input.candidateName !== undefined) data.candidateName = input.candidateName;
    if (input.summary !== undefined) data.summary = input.summary;

    await getPrisma().screeningCandidate.update({ where: { id: input.candidateId }, data });
  }

  /**
   * Moves a job from QUEUED to PROCESSING exactly once, so `startedAt` reflects the moment
   * work really began even when many workers start candidates concurrently.
   */
  async startJobProcessing(jobId: string): Promise<boolean> {
    return getPrisma().$transaction(async (tx) => {
      const updated = await tx.screeningJob.updateMany({
        where: { id: jobId, state: { in: ['CREATED', 'VALIDATING', 'QUEUED'] } },
        data: { state: 'PROCESSING', startedAt: new Date() },
      });
      if (updated.count === 0) return false;

      await tx.screeningJobEvent.create({
        data: {
          jobId,
          type: 'STATE_CHANGED' satisfies ScreeningJobEventType,
          message: 'Pemrosesan batch dimulai.',
          payload: toJson({ state: 'PROCESSING' }),
        },
      });
      return true;
    });
  }

  /**
   * Writes the batch's terminal state and its final credit numbers.
   *
   * Idempotent: a repeated finalisation rewrites the same values and appends another
   * PROGRESS event, which the ledger already guards against double-charging.
   */
  async finalizeJob(input: FinalizeJobInput): Promise<{ changed: boolean }> {
    return getPrisma().$transaction(async (tx) => {
      const job = await tx.screeningJob.findUnique({ where: { id: input.jobId } });
      if (!job) throw AppError.notFound('Sesi screening tidak ditemukan.');

      const changed = job.state !== input.state;
      await tx.screeningJob.update({
        where: { id: job.id },
        data: {
          state: input.state,
          completedAt: input.completedAt,
          failureReason: input.failureReason,
          creditsCharged: input.creditsCharged,
          // Whatever was not charged is no longer held: the reservation is settled or released.
          creditsReserved: 0,
        },
      });

      if (changed) {
        await tx.screeningJobEvent.create({
          data: {
            jobId: job.id,
            type: 'STATE_CHANGED' satisfies ScreeningJobEventType,
            message: input.message,
            payload: toJson({ state: input.state, from: job.state }),
          },
        });
      }

      await tx.screeningJobEvent.create({
        data: {
          jobId: job.id,
          type: 'PROGRESS' satisfies ScreeningJobEventType,
          message: 'Progres batch diperbarui.',
          payload: toJson(input.progress),
        },
      });

      return { changed };
    });
  }

  /** Fails every candidate that has not reached a terminal state (job cancellation). */
  async failOpenCandidates(input: {
    jobId: string;
    reason: string;
    completedAt: Date;
  }): Promise<number> {
    const updated = await getPrisma().screeningCandidate.updateMany({
      where: { jobId: input.jobId, state: { in: ['QUEUED', 'PROCESSING'] } },
      data: { state: 'FAILED', failureReason: input.reason, completedAt: input.completedAt },
    });
    return updated.count;
  }

  async recordJobEvent(input: {
    jobId: string;
    type: ScreeningJobEventType;
    message: string;
    payload?: unknown;
  }): Promise<void> {
    await getPrisma().screeningJobEvent.create({
      data: {
        jobId: input.jobId,
        type: input.type,
        message: input.message,
        payload: toJson(input.payload),
      },
    });
  }

  /**
   * Replaces a candidate's scoring output in one transaction.
   *
   * Deterministic rescoring is a replace, not an append: the criterion rows are deleted and
   * rewritten (their `EvidenceItem` rows cascade), so running the engine twice can never
   * double up a verdict or leave a stale score behind. The unique
   * `(candidate_id, requirement_id)` key is the schema-level guard for the same rule.
   */
  async replaceCandidateScores(input: CandidateScoreWrite): Promise<void> {
    await getPrisma().$transaction(async (tx) => {
      await tx.screeningCriterionResult.deleteMany({ where: { candidateId: input.candidateId } });

      for (const criterion of input.criteria) {
        const row = await tx.screeningCriterionResult.create({
          data: {
            candidateId: input.candidateId,
            requirementId: criterion.requirementId,
            status: criterion.status,
            confidence: criterion.confidence,
            earnedScore: criterion.earnedScore,
            normalisedWeight: criterion.normalisedWeight,
            notes: criterion.notes,
          },
        });

        if (criterion.evidence.length > 0) {
          await tx.evidenceItem.createMany({
            data: criterion.evidence.map((item) => ({
              candidateId: input.candidateId,
              criterionResultId: row.id,
              quote: item.quote,
              source: item.source,
              page: item.page,
              url: item.url,
              note: item.note,
            })),
          });
        }
      }

      await tx.screeningCandidate.update({
        where: { id: input.candidateId },
        data: {
          score: input.score,
          eligibilityStatus: input.eligibilityStatus,
          strengths: toJson(input.strengths),
          gaps: toJson(input.gaps),
          uncertainties: toJson(input.uncertainties),
        },
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Results and reports (Phase 15)                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Every candidate of a job with its scored criteria and their evidence.
   *
   * One query per level (candidates, criteria, evidence) instead of a nested include:
   * a 50-CV batch with 40 criteria each is 2 000 rows, and the join is cheaper to reason
   * about when the assembly happens in the service.
   */
  async findResultsForJob(jobId: string): Promise<{
    candidates: ScreeningCandidate[];
    criteria: Array<ScreeningCriterionResult & { requirement: ScreeningRequirement }>;
    evidence: EvidenceItem[];
  }> {
    const candidates = await getPrisma().screeningCandidate.findMany({
      where: { jobId },
      orderBy: [{ score: 'desc' }, { candidateName: 'asc' }, { id: 'asc' }],
    });

    const candidateIds = candidates.map((candidate) => candidate.id);
    if (candidateIds.length === 0) {
      return { candidates, criteria: [], evidence: [] };
    }

    const [criteria, evidence] = await Promise.all([
      getPrisma().screeningCriterionResult.findMany({
        where: { candidateId: { in: candidateIds } },
        include: { requirement: true },
        orderBy: [{ requirement: { sortOrder: 'asc' } }],
      }),
      getPrisma().evidenceItem.findMany({
        where: { candidateId: { in: candidateIds } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return { candidates, criteria, evidence };
  }

  /**
   * Candidates of a job for the bulk-verification preflight, in the same order the results
   * screen shows them (`score` desc, then name, then id).
   *
   * The full row is returned because eligibility needs `cv_text` (to find fetchable links)
   * and `state` (a CV that is still queued/processing is never verified yet). The caller is
   * the server; nothing here reaches the browser.
   */
  async listCandidatesForVerification(jobId: string): Promise<ScreeningCandidate[]> {
    return getPrisma().screeningCandidate.findMany({
      where: { jobId },
      orderBy: [{ score: 'desc' }, { candidateName: 'asc' }, { id: 'asc' }],
    });
  }

  async createReport(input: {
    jobId: string;
    createdByUserId: string;
    format: ReportFormat;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  }): Promise<GeneratedReport> {
    return getPrisma().generatedReport.create({
      data: {
        screeningJobId: input.jobId,
        createdByUserId: input.createdByUserId,
        format: input.format,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        // No storage provider yet: the bytes are streamed to the client, not persisted.
        storagePath: null,
      },
    });
  }

  async listReports(input: {
    jobId: string;
    skip: number;
    take: number;
  }): Promise<{ items: GeneratedReport[]; total: number }> {
    const [items, total] = await Promise.all([
      getPrisma().generatedReport.findMany({
        where: { screeningJobId: input.jobId },
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().generatedReport.count({ where: { screeningJobId: input.jobId } }),
    ]);
    return { items, total };
  }

  /* ------------------------------------------------------------------ */
  /* Integration evidence (Phase 16)                                    */
  /* ------------------------------------------------------------------ */

  /**
   * The most recent snapshot for one URL.
   *
   * There is no unique constraint on `(user_id, provider, source_url)`, so this is a lookup
   * rather than an upsert; a repeated verification updates the newest row for that URL.
   */
  async findIntegrationSnapshot(input: {
    userId: string;
    provider: IntegrationProvider;
    sourceUrl: string;
  }): Promise<IntegrationEvidenceSnapshot | null> {
    return getPrisma().integrationEvidenceSnapshot.findFirst({
      where: { userId: input.userId, provider: input.provider, sourceUrl: input.sourceUrl },
      orderBy: { fetchedAt: 'desc' },
    });
  }

  async saveIntegrationSnapshot(input: {
    userId: string;
    provider: IntegrationProvider;
    sourceUrl: string;
    status: VerificationStatus;
    payload: unknown;
    failureReason: string | null;
    expiresAt: Date | null;
    existingId?: string | undefined;
  }): Promise<IntegrationEvidenceSnapshot> {
    if (input.existingId) {
      return getPrisma().integrationEvidenceSnapshot.update({
        where: { id: input.existingId },
        data: {
          status: input.status,
          payload: toJson(input.payload),
          failureReason: input.failureReason,
          fetchedAt: new Date(),
          expiresAt: input.expiresAt,
        },
      });
    }

    return getPrisma().integrationEvidenceSnapshot.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        status: input.status,
        payload: toJson(input.payload),
        failureReason: input.failureReason,
        expiresAt: input.expiresAt,
      },
    });
  }

  /** Candidate-level evidence rows: no criterion result, so the results payload shows them. */
  async addCandidateEvidence(input: {
    candidateId: string;
    items: ReadonlyArray<{
      quote: string;
      source: EvidenceSource;
      url: string | null;
      note: string | null;
    }>;
  }): Promise<number> {
    if (input.items.length === 0) return 0;
    const created = await getPrisma().evidenceItem.createMany({
      data: input.items.map((item) => ({
        candidateId: input.candidateId,
        criterionResultId: null,
        quote: item.quote,
        source: item.source,
        page: null,
        url: item.url,
        note: item.note,
      })),
    });
    return created.count;
  }

  /** Removes the previous verification evidence so a re-run replaces instead of stacking. */
  async clearCandidateVerificationEvidence(candidateId: string): Promise<number> {
    const deleted = await getPrisma().evidenceItem.deleteMany({
      where: { candidateId, criterionResultId: null, source: { in: ['GITHUB', 'PORTFOLIO'] } },
    });
    return deleted.count;
  }

  async setCandidateVerificationStatus(input: {
    candidateId: string;
    status: VerificationStatus;
  }): Promise<void> {
    await getPrisma().screeningCandidate.update({
      where: { id: input.candidateId },
      data: { verificationStatus: input.status },
    });
  }

  /**
   * Candidate counts per state for one or more jobs, in a single query.
   *
   * Progress and the job list both derive `queued`/`processing` from this, rather than
   * loading candidate rows.
   */
  async countCandidatesByState(
    jobIds: readonly string[],
  ): Promise<Map<string, Record<string, number>>> {
    const result = new Map<string, Record<string, number>>();
    if (jobIds.length === 0) return result;

    const grouped = await getPrisma().screeningCandidate.groupBy({
      by: ['jobId', 'state'],
      where: { jobId: { in: [...jobIds] } },
      _count: { _all: true },
    });

    for (const row of grouped) {
      const counts = result.get(row.jobId) ?? {};
      counts[row.state] = row._count._all;
      result.set(row.jobId, counts);
    }
    return result;
  }

  /**
   * Cancels a job that has not finished.
   *
   * Returns `null` when the job does not exist for this user or is already in a terminal
   * state, so the caller can distinguish 404 from 409.
   */
  async cancelJob(input: {
    jobId: string;
    userId: string;
  }): Promise<{ job: ScreeningJobWithRequirements | null; changed: boolean }> {
    const changed = await getPrisma().$transaction(async (tx) => {
      const updated = await tx.screeningJob.updateMany({
        where: {
          id: input.jobId,
          userId: input.userId,
          state: { notIn: ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'] },
        },
        data: { state: 'CANCELLED', cancelledAt: new Date() },
      });

      if (updated.count === 0) return false;

      await tx.screeningJobEvent.create({
        data: {
          jobId: input.jobId,
          type: 'STATE_CHANGED' satisfies ScreeningJobEventType,
          message: 'Screening job dibatalkan.',
          payload: toJson({ state: 'CANCELLED' }),
        },
      });

      return true;
    });

    const job = await this.findJobById(input.jobId);
    return { job: job && job.userId === input.userId ? job : null, changed };
  }
}
