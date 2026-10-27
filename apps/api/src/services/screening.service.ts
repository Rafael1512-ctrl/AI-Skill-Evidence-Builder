import {
  SCORING_ENGINE_VERSION,
  type CreateScreeningJobInput,
  type ScreeningJobDetail,
  type ScreeningJobList,
  type ScreeningJobSummary,
  type ScreeningProgress,
} from '@aseb/shared';
import { z } from 'zod';

import type { ScreeningJob, ScreeningRequirement } from '../generated/prisma/client.js';
import { HRD_SCREENING_PROMPT_VERSION } from '../prompts/hrd/screeningPrompt.js';
import {
  ScreeningRepository,
  type ScreeningJobWithRequirements,
} from '../repositories/screening.repository.js';
import { AppError } from '../utils/errors.js';
import { toIso } from '../utils/values.js';
import {
  recruiterPreferenceService,
  type RecruiterPreferenceService,
} from './recruiter-preference.service.js';
import { screeningRunnerService, type ScreeningRunnerService } from './screening-runner.service.js';

/** Every job starts at requirement version 1: requirements are frozen at creation. */
const INITIAL_REQUIREMENT_VERSION = 1;

const TERMINAL_STATES: readonly ScreeningJob['state'][] = [
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
];

const categoryWeightsSchema = z.record(z.string(), z.number());

/** Stored JSON is re-validated on read; a corrupt value degrades to "no weights". */
function toCategoryWeights(value: unknown): Record<string, number> | null {
  const parsed = categoryWeightsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Screening job lifecycle (Phase 10 slice).
 *
 * A job is created with its requirements, the recruiter preference version it was built
 * from, and the scoring/prompt versions frozen alongside it, so a later result stays
 * reproducible. Candidates, credits and queueing arrive in Phases 11-12; this service
 * therefore never reserves credits.
 */
export class ScreeningService {
  constructor(
    private readonly repository = new ScreeningRepository(),
    private readonly preferences: RecruiterPreferenceService = recruiterPreferenceService,
    private readonly runner: ScreeningRunnerService = screeningRunnerService,
  ) {}

  private toSummary(job: ScreeningJob, counts: Record<string, number> = {}): ScreeningJobSummary {
    return {
      id: job.id,
      title: job.title,
      state: job.state,
      totalCandidates: job.totalCandidates,
      queuedCandidates: counts.QUEUED ?? 0,
      processingCandidates: counts.PROCESSING ?? 0,
      completedCandidates: job.completedCandidates,
      failedCandidates: job.failedCandidates,
      creditsReserved: job.creditsReserved,
      creditsCharged: job.creditsCharged,
      categoryWeights: toCategoryWeights(job.categoryWeights),
      scoringConfigurationVersion: job.scoringConfigurationVersion,
      preferenceVersion: job.preferenceVersion,
      createdAt: job.createdAt.toISOString(),
      startedAt: toIso(job.startedAt),
      completedAt: toIso(job.completedAt),
    };
  }

  private toRequirementDto(requirement: ScreeningRequirement) {
    return {
      id: requirement.id,
      sortOrder: requirement.sortOrder,
      text: requirement.text,
      category: requirement.category,
      requirementClass: requirement.requirementClass,
      weight: requirement.weight,
      hardRequirement: requirement.hardRequirement,
    };
  }

  private toDetail(
    job: ScreeningJobWithRequirements,
    counts: Record<string, number> = {},
  ): ScreeningJobDetail {
    return {
      ...this.toSummary(job, counts),
      description: job.description,
      screeningNotes: job.screeningNotes,
      requirementVersion: job.requirementVersion,
      promptVersion: job.promptVersion,
      failureReason: job.failureReason,
      cancelledAt: toIso(job.cancelledAt),
      updatedAt: job.updatedAt.toISOString(),
      requirements: job.requirements.map((requirement) => this.toRequirementDto(requirement)),
    };
  }

  /** Creates the job and its requirements. No credits are reserved at this stage. */
  async createJob(userId: string, input: CreateScreeningJobInput): Promise<ScreeningJobDetail> {
    const usePreferences = input.useRecruiterPreferences;
    const snapshot = usePreferences
      ? await this.preferences.get(userId)
      : { preferences: null, version: 0 };

    const categoryWeights = input.categoryWeights ?? snapshot.preferences?.defaultWeights ?? null;

    const inheritedNotes = usePreferences ? (snapshot.preferences?.screeningNotes ?? '') : '';
    const notes = (input.screeningNotes ?? inheritedNotes).trim();

    const job = await this.repository.createJobWithRequirements({
      userId,
      title: input.title,
      description: input.description,
      screeningNotes: notes.length > 0 ? notes : null,
      categoryWeights,
      scoringConfigurationVersion: SCORING_ENGINE_VERSION,
      preferenceVersion: snapshot.version,
      requirementVersion: INITIAL_REQUIREMENT_VERSION,
      promptVersion: HRD_SCREENING_PROMPT_VERSION,
      requirements: input.requirements.map((requirement) => ({
        text: requirement.text,
        category: requirement.category,
        requirementClass: requirement.requirementClass,
        weight: requirement.weight,
        hardRequirement: requirement.hardRequirement,
      })),
    });

    return this.toDetail(job);
  }

  async listJobs(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<ScreeningJobList> {
    const { items, total } = await this.repository.listJobs({
      userId: input.userId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    const counts = await this.repository.countCandidatesByState(items.map((job) => job.id));

    return {
      items: items.map((job) => this.toSummary(job, counts.get(job.id) ?? {})),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  /** Owner-scoped: another user's job is indistinguishable from a missing one. */
  async getJob(userId: string, jobId: string): Promise<ScreeningJobDetail> {
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }
    const counts = await this.repository.countCandidatesByState([job.id]);
    return this.toDetail(job, counts.get(job.id) ?? {});
  }

  /**
   * Refreshed job summary.
   *
   * Used by the batch upload after it has written candidates and moved the job to
   * `QUEUED`, so the response and the job list always agree on the counters.
   */
  async jobSummary(userId: string, jobId: string): Promise<ScreeningJobSummary> {
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }
    const counts = await this.repository.countCandidatesByState([job.id]);
    return this.toSummary(job, counts.get(job.id) ?? {});
  }

  async cancelJob(userId: string, jobId: string): Promise<ScreeningJobDetail> {
    const existing = await this.repository.findJobById(jobId);
    if (!existing || existing.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }
    if (TERMINAL_STATES.includes(existing.state)) {
      throw AppError.conflict('Sesi screening ini sudah selesai dan tidak dapat dibatalkan.');
    }

    const { job, changed } = await this.repository.cancelJob({ jobId, userId });
    if (!changed || !job) {
      throw AppError.conflict('Sesi screening ini sudah selesai dan tidak dapat dibatalkan.');
    }

    // Cancelling releases the credit hold: candidates that already finished stay charged,
    // everything still queued or running is failed and its reservation released.
    await this.runner.cancelRemaining(jobId, 'Sesi screening dibatalkan.');

    const cancelled = await this.repository.findJobById(jobId);
    const counts = await this.repository.countCandidatesByState([jobId]);
    return this.toDetail(cancelled ?? job, counts.get(jobId) ?? {});
  }

  async progress(userId: string, jobId: string): Promise<ScreeningProgress> {
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId) {
      throw AppError.notFound('Sesi screening tidak ditemukan.');
    }

    const counts = await this.repository.countCandidatesByState([job.id]);
    const states = counts.get(job.id) ?? {};
    const queued = states.QUEUED ?? 0;
    const processing = states.PROCESSING ?? 0;
    const completed = states.COMPLETED ?? 0;
    const failed = states.FAILED ?? 0;
    const total = job.totalCandidates || queued + processing + completed + failed;
    const settled = completed + failed;
    const finished = TERMINAL_STATES.includes(job.state);

    return {
      jobId: job.id,
      state: job.state,
      total,
      completed,
      failed,
      processing,
      queued,
      percent: total === 0 ? 0 : Math.min(100, Math.round((settled / total) * 100)),
      partialSuccess: finished && completed > 0 && failed > 0,
      finished,
    };
  }
}

export const screeningService = new ScreeningService();
