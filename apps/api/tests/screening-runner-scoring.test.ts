import { describe, expect, it } from 'vitest';

import type { ScoringService } from '../src/services/scoring/scoring.service.js';
import type { ScreeningRepository } from '../src/repositories/screening.repository.js';
import {
  ScreeningRunnerService,
  type CandidateCounts,
} from '../src/services/screening-runner.service.js';
import type { CreditService } from '../src/services/credit.service.js';
import type { CandidateProcessor } from '../src/workers/screening.processor.js';

/**
 * The runner must score the work it just did (Phase 23).
 *
 * `processCandidate` loads the candidate *before* the processor runs, so that snapshot's
 * `analysis_json` is still null. The scoring call therefore has to receive the freshly produced
 * envelope explicitly; passing the stale candidate made every candidate end up `COMPLETED` with
 * `score: null`, no criterion rows and empty results (PROJECT_CONTEXT §8.52).
 *
 * Pure and offline: repository, credits, processor and scoring are injected fakes.
 */

const ENVELOPE = {
  promptVersion: 'HRD_EVIDENCE_EXTRACTION_V1',
  preferenceVersion: 0,
  scoringConfigurationVersion: '1.0.0',
  requirementVersion: 1,
  provider: 'stub',
  model: 'stub-1',
  processedAt: '2026-09-26T10:00:00.000Z',
  grounding: { droppedQuotes: 0, downgradedCriteria: 0, pageVerification: 'unavailable' },
  evidence: { candidateName: 'Andi', summary: 'Ringkasan', gaps: [], uncertainties: [], criteria: [] },
};

function fakeRepository() {
  const finished: Array<Record<string, unknown>> = [];
  const counts = new Map<string, Record<string, number>>([['job-1', { COMPLETED: 1 }]]);

  const repository = {
    async findCandidateWithJob() {
      return {
        id: 'cand-1',
        jobId: 'job-1',
        candidateName: 'Andi',
        // The point of the test: the row as loaded before processing has no evidence yet.
        analysisJson: null,
        state: 'QUEUED',
        job: {
          id: 'job-1',
          userId: 'user-1',
          state: 'PROCESSING',
          requirements: [],
          reservationId: 'res-1',
          title: 'Backend Engineer',
          description: 'Node.js',
          preferenceVersion: 0,
          scoringConfigurationVersion: '1.0.0',
          requirementVersion: 1,
          categoryWeights: null,
        },
      };
    },
    async markCandidateProcessing() {},
    async startJobProcessing() {
      return false;
    },
    async markCandidateFinished(input: Record<string, unknown>) {
      finished.push(input);
    },
    async recordJobEvent() {},
    async countCandidatesByState() {
      return counts;
    },
    async findJobById() {
      return {
        id: 'job-1',
        userId: 'user-1',
        state: 'PROCESSING',
        reservationId: 'res-1',
        requirements: [],
        categoryWeights: null,
        preferenceVersion: 0,
        scoringConfigurationVersion: '1.0.0',
      };
    },
    async finalizeJob() {
      return { changed: true };
    },
  } as unknown as ScreeningRepository;

  return { repository, finished };
}

function fakeScoring() {
  const calls: Array<Record<string, unknown>> = [];
  const scoring = {
    async scoreAndStore(input: Record<string, unknown>) {
      calls.push(input);
      return { scored: true, score: 100, eligibilityStatus: 'HIGH_MATCH', reason: null };
    },
  } as unknown as ScoringService;
  return { scoring, calls };
}

function runner() {
  const repo = fakeRepository();
  const scoring = fakeScoring();
  const processor: CandidateProcessor = {
    name: 'stub',
    process: async () => ({ summary: 'Ringkasan', analysis: ENVELOPE }),
  };
  const credits = {
    async settle() {
      return { charged: 1, released: 0, alreadySettled: false };
    },
  } as unknown as CreditService;

  const service = new ScreeningRunnerService(
    repo.repository,
    credits,
    () => processor,
    scoring.scoring,
  );
  return { service, ...repo, ...scoring };
}

describe('screening runner scoring', () => {
  it('hands the freshly produced envelope to the scoring service', async () => {
    const { service, calls, finished } = runner();

    await service.processCandidate({
      candidateId: 'cand-1',
      jobId: 'job-1',
      attempt: 1,
      isFinalAttempt: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.envelope).toEqual(ENVELOPE);
    // The stale snapshot is passed along, but the envelope is what scoring must use.
    expect((calls[0]?.candidate as { analysisJson: unknown }).analysisJson).toBeNull();

    // The candidate is still only marked COMPLETED once scoring has run.
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ state: 'COMPLETED', analysisJson: ENVELOPE });
  });

  it('passes a null envelope when the processor produced none, so nothing is invented', async () => {
    const repo = fakeRepository();
    const scoring = fakeScoring();
    const credits = {
      async settle() {
        return { charged: 0, released: 0, alreadySettled: false };
      },
    } as unknown as CreditService;
    const service = new ScreeningRunnerService(
      repo.repository,
      credits,
      () => ({ name: 'stub', process: async () => ({ summary: 'tanpa bukti' }) }),
      scoring.scoring,
    );

    await service.processCandidate({
      candidateId: 'cand-1',
      jobId: 'job-1',
      attempt: 1,
      isFinalAttempt: true,
    });

    expect(scoring.calls[0]?.envelope).toBeNull();
  });
});

/** Keeps the imported type honest: the runner's batch derivation is part of its contract. */
export type _Counts = CandidateCounts;
