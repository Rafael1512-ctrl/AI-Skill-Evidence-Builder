import type { ScreeningCandidateJobData } from '../queues/types.js';
import type { ScreeningCandidate } from '../generated/prisma/client.js';
import { ScreeningRepository } from '../repositories/screening.repository.js';
import { logger } from '../utils/logger.js';
import { creditService, type CreditService } from './credit.service.js';
import {
  getCandidateProcessorOverride,
  type CandidateProcessor,
} from '../workers/screening.processor.js';
import { screeningEvidenceProcessor } from './screening-evidence.service.js';
import { scoringService, type ScoringService } from './scoring/scoring.service.js';

/** Terminal job states, mirroring `screeningService`. */
const TERMINAL_JOB_STATES = ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'] as const;

export const CANCELLED_CANDIDATE_REASON =
  'Sesi screening dibatalkan sebelum kandidat ini diproses.';

/**
 * The processor a delivery uses: a test override when one is registered, otherwise the real
 * evidence extraction. Resolving it here (rather than in the worker entry point) means the
 * API's in-process queue and a dedicated BullMQ worker behave identically.
 */
export function resolveCandidateProcessor(): CandidateProcessor {
  return getCandidateProcessorOverride() ?? screeningEvidenceProcessor;
}

export interface CandidateCounts {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

/**
 * Outcome of a finished batch.
 *
 * Returns `null` while any candidate is still queued or running, and also for a job with no
 * candidates at all: there is nothing to finalise in that case.
 */
export function deriveJobOutcome(
  counts: CandidateCounts,
): 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | null {
  if (counts.queued > 0 || counts.processing > 0) return null;
  const settled = counts.completed + counts.failed;
  if (settled === 0) return null;
  if (counts.completed > 0 && counts.failed > 0) return 'PARTIALLY_COMPLETED';
  return counts.completed > 0 ? 'COMPLETED' : 'FAILED';
}

/**
 * Screening batch runner (Phase 12).
 *
 * One public entry point per queue delivery (`processCandidate`) plus the batch-level
 * bookkeeping the queue needs: moving the job to `PROCESSING`, settling the credit hold for
 * exactly the candidates that were delivered, and reaching a terminal state
 * (`COMPLETED` / `PARTIALLY_COMPLETED` / `FAILED`).
 *
 * The per-candidate *work* is injected (`CandidateProcessor`), which is why this phase can
 * be tested end to end without an AI call and why Phase 13 only has to supply a processor.
 */
export class ScreeningRunnerService {
  constructor(
    private readonly repository = new ScreeningRepository(),
    private readonly credits: CreditService = creditService,
    private readonly processor: () => CandidateProcessor = resolveCandidateProcessor,
    private readonly scoring: ScoringService = scoringService,
  ) {}

  private static reason(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Penyebab tidak diketahui.';
    return message.slice(0, 300);
  }

  private async failCandidate(candidate: ScreeningCandidate, reason: string): Promise<void> {
    await this.repository.markCandidateFinished({
      candidateId: candidate.id,
      state: 'FAILED',
      failureReason: reason,
      completedAt: new Date(),
    });
    await this.repository.recordJobEvent({
      jobId: candidate.jobId,
      type: 'CANDIDATE_FAILED',
      message: `Kandidat "${candidate.candidateName}" gagal diproses.`,
      payload: { candidateId: candidate.id, reason },
    });
  }

  /**
   * Handles one attempt for one candidate.
   *
   * Throws only to ask the driver for a retry, and only before the final attempt. A
   * redelivery of an already finished candidate is a no-op, so at-least-once delivery can
   * never double-charge or overwrite a result.
   */
  async processCandidate(data: ScreeningCandidateJobData): Promise<void> {
    const candidate = await this.repository.findCandidateWithJob(data.candidateId);
    if (!candidate) {
      logger.warn({ candidateId: data.candidateId }, 'Screening candidate no longer exists');
      return;
    }
    if (candidate.state === 'COMPLETED' || candidate.state === 'FAILED') {
      logger.debug(
        { candidateId: candidate.id, state: candidate.state },
        'Skipping an already finished screening candidate',
      );
      return;
    }

    // A cancelled job stops work: the candidate is failed and the batch stays CANCELLED.
    if (candidate.job.state === 'CANCELLED') {
      await this.failCandidate(candidate, CANCELLED_CANDIDATE_REASON);
      return;
    }

    await this.repository.markCandidateProcessing({
      candidateId: candidate.id,
      startedAt: new Date(),
    });
    await this.repository.startJobProcessing(candidate.jobId);

    const processor = this.processor();
    try {
      const result = await processor.process({
        candidate: { ...candidate, state: 'PROCESSING' },
        job: candidate.job,
      });

      // Score before the candidate is marked COMPLETED: a completed candidate either has
      // deterministic scores, or (for a processor that stored no evidence envelope) an
      // explicit unscored state - never a stale verdict from an earlier attempt. The envelope
      // is passed explicitly because `candidate` was loaded before the processor ran and its
      // `analysis_json` is still null at this point.
      await this.scoring.scoreAndStore({
        job: candidate.job,
        candidate,
        envelope: result.analysis ?? null,
      });

      await this.repository.markCandidateFinished({
        candidateId: candidate.id,
        state: 'COMPLETED',
        failureReason: null,
        completedAt: new Date(),
        analysisJson: result.analysis ?? null,
        ...(result.candidateName !== undefined ? { candidateName: result.candidateName } : {}),
        summary: result.summary ?? null,
      });
      await this.repository.recordJobEvent({
        jobId: candidate.jobId,
        type: 'CANDIDATE_COMPLETED',
        message: `Kandidat "${candidate.candidateName}" selesai diproses.`,
        payload: { candidateId: candidate.id, processor: processor.name },
      });
    } catch (error) {
      const reason = ScreeningRunnerService.reason(error);

      if (!data.isFinalAttempt) {
        await this.repository.markCandidateQueuedForRetry({
          candidateId: candidate.id,
          failureReason: reason,
        });
        await this.repository.recordJobEvent({
          jobId: candidate.jobId,
          type: 'CANDIDATE_RETRIED',
          message: `Percobaan ${data.attempt} untuk "${candidate.candidateName}" gagal; akan dicoba lagi.`,
          payload: { candidateId: candidate.id, attempt: data.attempt, reason },
        });
        throw error;
      }

      logger.error(
        { err: error, candidateId: candidate.id, attempt: data.attempt },
        'Screening candidate failed permanently',
      );
      await this.failCandidate(candidate, reason);
    }

    await this.finalizeIfComplete(candidate.jobId);
  }

  /**
   * Settles the batch once every candidate has finished.
   *
   * The hold is settled for the candidates that were actually delivered (`unitPrice x
   * completed`) and the remainder is released by the same atomic operation, so a partial or
   * fully failed batch never bills for work that did not happen. `CreditService.settle` and
   * the ledger's idempotency key make a repeated finalisation harmless.
   */
  async finalizeIfComplete(
    jobId: string,
  ): Promise<'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | null> {
    const job = await this.repository.findJobById(jobId);
    if (!job) return null;
    if ((TERMINAL_JOB_STATES as readonly string[]).includes(job.state)) {
      return job.state as 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED';
    }

    const countsByState = await this.repository.countCandidatesByState([jobId]);
    const raw = countsByState.get(jobId) ?? {};
    const counts: CandidateCounts = {
      queued: raw.QUEUED ?? 0,
      processing: raw.PROCESSING ?? 0,
      completed: raw.COMPLETED ?? 0,
      failed: raw.FAILED ?? 0,
    };

    const state = deriveJobOutcome(counts);
    if (!state) return null;

    const outstanding = counts.queued + counts.processing;
    const settled = job.reservationId
      ? await this.credits.settle({
          reservationId: job.reservationId,
          quantity: counts.completed,
          description: `Screening ${counts.completed} CV`,
        })
      : { charged: 0, released: 0, alreadySettled: false };

    await this.repository.finalizeJob({
      jobId,
      state,
      completedAt: new Date(),
      failureReason:
        state === 'COMPLETED'
          ? null
          : `${counts.failed} dari ${counts.completed + counts.failed} kandidat gagal diproses.`,
      creditsCharged: settled.charged,
      message:
        state === 'COMPLETED'
          ? 'Semua kandidat selesai diproses.'
          : state === 'PARTIALLY_COMPLETED'
            ? `Batch selesai sebagian: ${counts.completed} berhasil, ${counts.failed} gagal.`
            : 'Batch gagal: tidak ada kandidat yang berhasil diproses.',
      progress: { ...counts, outstanding },
    });

    return state;
  }

  /**
   * Cancels the remaining work for a job (Phase 10's `PATCH .../:jobId`).
   *
   * Candidates that already finished keep their result and are still charged; everything
   * else is failed and its hold released, so cancelling never leaks reserved credits.
   */
  async cancelRemaining(jobId: string, reason: string): Promise<void> {
    const failedCandidates = await this.repository.failOpenCandidates({
      jobId,
      reason,
      completedAt: new Date(),
    });

    const countsByState = await this.repository.countCandidatesByState([jobId]);
    const raw = countsByState.get(jobId) ?? {};
    const completed = raw.COMPLETED ?? 0;

    const job = await this.repository.findJobById(jobId);
    const settled = job?.reservationId
      ? await this.credits.settle({
          reservationId: job.reservationId,
          quantity: completed,
          description: `Screening ${completed} CV (dibatalkan)`,
        })
      : { charged: 0, released: 0, alreadySettled: false };

    await this.repository.finalizeJob({
      jobId,
      state: 'CANCELLED',
      completedAt: new Date(),
      failureReason: reason,
      creditsCharged: settled.charged,
      message: 'Sesi screening dibatalkan.',
      progress: {
        queued: 0,
        processing: 0,
        completed,
        failed: (raw.FAILED ?? 0) + failedCandidates,
      },
    });
  }
}

export const screeningRunnerService = new ScreeningRunnerService();
