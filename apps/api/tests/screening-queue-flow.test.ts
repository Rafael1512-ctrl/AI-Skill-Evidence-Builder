import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SCORING_ENGINE_VERSION, candidateEvidenceEnvelopeSchema } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { setScreeningQueue } from '../src/queues/index.js';
import { InProcessScreeningQueue } from '../src/queues/in-process.queue.js';
import { creditService } from '../src/services/credit.service.js';
import { ScreeningRepository } from '../src/repositories/screening.repository.js';
import { pricingService } from '../src/services/pricing.service.js';
import { screeningRunnerService } from '../src/services/screening-runner.service.js';
import { scoringService } from '../src/services/scoring/scoring.service.js';
import {
  setCandidateProcessor,
  type CandidateProcessor,
} from '../src/workers/screening.processor.js';
import { startScreeningWorker } from '../src/workers/screening.worker.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildTextPdf } from './helpers/pdf.js';

/**
 * End-to-end coverage of the screening queue.
 *
 * Runs against real PostgreSQL semantics (PGlite) with the in-process driver, and injects a
 * stub `CandidateProcessor`: Phase 12 owns the plumbing (states, retries, progress,
 * settlement, idempotency), while the real evidence extraction arrives in Phase 13. The
 * processor the stub replaces is asserted separately, and it never marks a candidate
 * complete.
 */

const CV_LINES = [
  'Andi Pratama',
  'Software Engineer',
  'Pengalaman lima tahun membangun layanan backend dengan Node.js dan PostgreSQL.',
];

const VALID_JOB = {
  title: 'Backend Engineer',
  description: 'Kami mencari backend engineer berpengalaman dengan Node.js dan PostgreSQL.',
  requirements: [{ text: 'Pengalaman minimal 3 tahun dengan Node.js', weight: 30 }],
} as const;

function passingProcessor(): CandidateProcessor {
  return {
    name: 'stub',
    process: async ({ candidate }) => ({
      summary: `Ringkasan ${candidate.candidateName}`,
      strengths: ['x'],
    }),
  };
}

describe('screening queue flow', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let session: DevSession;
  let queue: InProcessScreeningQueue;
  let unitCredits: number;
  const repository = new ScreeningRepository();

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ app } = await import('../src/server.test-helper.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    resetRateLimits();
    session = await signUpDevUser(app);
    unitCredits = await pricingService.resolve('HRD_SCREEN_PER_CV');

    queue = new InProcessScreeningQueue({ concurrency: 2, attempts: 3, backoffMs: 5 });
    setScreeningQueue(queue);
    setCandidateProcessor(null);
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().reset();
  });

  afterEach(async () => {
    await queue.stop();
    setScreeningQueue(null);
    setCandidateProcessor(null);
  });

  async function createJob(): Promise<string> {
    const response = await request(app)
      .post('/api/screening/jobs')
      .set(bearer(session))
      .send(VALID_JOB);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.job.id as string;
  }

  async function grantCredits(credits: number): Promise<void> {
    await creditService.grantTopUp({
      userId: session.userId,
      credits,
      amountIdr: credits * 1_000,
      paymentTransactionId: `pay-${session.userId}-${credits}`,
    });
  }

  async function upload(jobId: string, names: readonly string[]): Promise<void> {
    let call = request(app).post(`/api/screening/jobs/${jobId}/candidates`).set(bearer(session));
    for (const name of names) {
      call = call.attach('files', buildTextPdf(CV_LINES), name);
    }
    const response = await call;
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  }

  function candidatesOf(jobId: string) {
    return ctx.prisma.screeningCandidate.findMany({
      where: { jobId },
      orderBy: { fileName: 'asc' },
    });
  }

  function eventsOf(jobId: string) {
    return ctx.prisma.screeningJobEvent.findMany({ where: { jobId } });
  }

  function wallet() {
    return request(app).get('/api/credits/wallet').set(bearer(session));
  }

  it('processes a batch, settles the credits and reaches COMPLETED', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    setCandidateProcessor(passingProcessor());
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf', 'budi.pdf', 'citra.pdf']);
    await queue.waitForIdle();

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('COMPLETED');
    expect(job?.creditsCharged).toBe(unitCredits * 3);
    expect(job?.creditsReserved).toBe(0);
    expect(job?.completedAt).not.toBeNull();

    const candidates = await candidatesOf(jobId);
    expect(candidates.map((candidate) => candidate.state)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);
    expect(candidates[0]?.summary).toBe('Ringkasan andi');
    expect(candidates[0]?.attempts).toBe(1);
    expect(candidates[0]?.completedAt).not.toBeNull();

    const reservation = await ctx.prisma.creditReservation.findFirst({
      where: { referenceId: jobId },
    });
    expect(reservation?.state).toBe('SETTLED');
    expect(reservation?.settledCredits).toBe(unitCredits * 3);

    // Only the delivered work is charged, and nothing stays held.
    const balance = await wallet();
    expect(balance.body.data).toMatchObject({
      balance: 10 - unitCredits * 3,
      reserved: 0,
      available: 10 - unitCredits * 3,
    });

    const progress = await request(app)
      .get(`/api/screening/jobs/${jobId}/progress`)
      .set(bearer(session));
    expect(progress.body.data.progress).toMatchObject({
      state: 'COMPLETED',
      total: 3,
      completed: 3,
      failed: 0,
      queued: 0,
      processing: 0,
      percent: 100,
      partialSuccess: false,
      finished: true,
    });

    const events = await eventsOf(jobId);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'CANDIDATE_COMPLETED')).toHaveLength(3);
    expect(types).toContain('STATE_CHANGED');
    expect(types).toContain('PROGRESS');
  });

  it('retries a transient failure and completes on the next attempt', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    let calls = 0;
    setCandidateProcessor({
      name: 'stub',
      process: async () => {
        calls += 1;
        if (calls === 1) throw new Error('penyedia AI sibuk');
        return { summary: 'ok' };
      },
    });
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const [candidate] = await candidatesOf(jobId);
    expect(candidate?.state).toBe('COMPLETED');
    expect(candidate?.attempts).toBe(2);

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('COMPLETED');
    expect(job?.creditsCharged).toBe(unitCredits);

    const events = await eventsOf(jobId);
    expect(events.filter((event) => event.type === 'CANDIDATE_RETRIED')).toHaveLength(1);
  });

  it('marks a partial batch PARTIALLY_COMPLETED and charges only the successes', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    setCandidateProcessor({
      name: 'stub',
      process: async ({ candidate }) => {
        if (candidate.fileName === 'budi.pdf') throw new Error('model tidak tersedia');
        return { summary: 'ok' };
      },
    });
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf', 'budi.pdf', 'citra.pdf']);
    await queue.waitForIdle();

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('PARTIALLY_COMPLETED');
    expect(job?.creditsCharged).toBe(unitCredits * 2);
    expect(job?.creditsReserved).toBe(0);
    expect(job?.failureReason).toContain('1 dari 3');

    const candidates = await candidatesOf(jobId);
    const failed = candidates.find((candidate) => candidate.fileName === 'budi.pdf');
    expect(failed?.state).toBe('FAILED');
    expect(failed?.attempts).toBe(3);
    expect(failed?.failureReason).toBe('model tidak tersedia');

    const balance = await wallet();
    expect(balance.body.data).toMatchObject({ balance: 10 - unitCredits * 2, reserved: 0 });

    const events = await eventsOf(jobId);
    const types = events.map((event) => event.type);
    expect(types.filter((type) => type === 'CANDIDATE_RETRIED')).toHaveLength(2);
    expect(types.filter((type) => type === 'CANDIDATE_FAILED')).toHaveLength(1);
    expect(types.filter((type) => type === 'CANDIDATE_COMPLETED')).toHaveLength(2);
  });

  it('releases the whole hold when every candidate fails', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    setCandidateProcessor({
      name: 'stub',
      process: async () => {
        throw new Error('penyedia AI tidak dapat dihubungi');
      },
    });
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf', 'budi.pdf']);
    await queue.waitForIdle();

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('FAILED');
    expect(job?.creditsCharged).toBe(0);
    expect(job?.creditsReserved).toBe(0);
    expect(job?.failureReason).toContain('2 dari 2');

    const reservation = await ctx.prisma.creditReservation.findFirst({
      where: { referenceId: jobId },
    });
    expect(reservation?.state).toBe('SETTLED');
    expect(reservation?.settledCredits).toBe(0);

    const balance = await wallet();
    expect(balance.body.data).toMatchObject({ balance: 10, reserved: 0, available: 10 });
  });

  it('extracts evidence with the real processor and records the prompt version', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    // No override: the runtime default processor runs against the mock AI provider.
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const [candidate] = await candidatesOf(jobId);
    expect(candidate?.state).toBe('COMPLETED');
    expect(candidate?.summary).toBeTruthy();

    // The stored envelope records which versions produced this result.
    const envelope = candidateEvidenceEnvelopeSchema.parse(candidate?.analysisJson);
    expect(envelope.promptVersion).toBe('HRD_EVIDENCE_EXTRACTION_V1');
    expect(envelope.preferenceVersion).toBe(0);
    expect(envelope.scoringConfigurationVersion).toBe(SCORING_ENGINE_VERSION);
    expect(envelope.grounding).toEqual({
      droppedQuotes: 0,
      downgradedCriteria: 0,
      pageVerification: 'unavailable',
    });
    // The requirement mentions Node.js, which the CV also mentions: FOUND with a real quote.
    expect(envelope.evidence.criteria).toHaveLength(1);
    expect(envelope.evidence.criteria[0]).toMatchObject({ status: 'FOUND' });
    expect(envelope.evidence.criteria[0]?.evidence[0]?.page).toBeNull();

    // Provider cost is recorded against the feature and the candidate.
    const usage = await ctx.prisma.aiUsageRecord.findMany({
      where: { screeningCandidateId: candidate?.id },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      feature: 'HRD_SCREEN_PER_CV',
      promptVersion: 'HRD_EVIDENCE_EXTRACTION_V1',
      screeningJobId: jobId,
      userId: session.userId,
    });

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('COMPLETED');
    expect(job?.creditsCharged).toBe(unitCredits);

    const balance = await wallet();
    expect(balance.body.data).toMatchObject({ balance: 10 - unitCredits, reserved: 0 });
  });

  it('fails the candidate and refunds it when the provider is unavailable', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const { getMockProvider } = await import('../src/providers/ai/index.js');
    // One failure per attempt: the queue retries the configured number of times.
    getMockProvider().configure({ failNext: 3 });
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const [candidate] = await candidatesOf(jobId);
    expect(candidate?.state).toBe('FAILED');
    expect(candidate?.attempts).toBe(3);
    expect(candidate?.analysisJson).toBeNull();

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('FAILED');
    expect(job?.creditsCharged).toBe(0);
    expect(job?.creditsReserved).toBe(0);

    // A provider outage must never cost the recruiter a credit.
    const balance = await wallet();
    expect(balance.body.data).toMatchObject({ balance: 10, reserved: 0, available: 10 });
  });

  it('scores the candidate deterministically from the stored evidence', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const [candidate] = await candidatesOf(jobId);
    expect(candidate?.state).toBe('COMPLETED');
    // The requirement mentions Node.js and the CV does too, so the only criterion is FOUND:
    // full credit, one criterion, one evidence row.
    expect(candidate?.score).toBe(100);
    expect(candidate?.eligibilityStatus).toBe('HIGH_MATCH');
    expect(candidate?.verificationStatus).toBe('NOT_CHECKED');
    expect(candidate?.strengths).toEqual(['Pengalaman minimal 3 tahun dengan Node.js']);
    expect(candidate?.gaps).toEqual([]);
    expect(candidate?.uncertainties).toEqual([]);

    const criteria = await ctx.prisma.screeningCriterionResult.findMany({
      where: { candidateId: candidate?.id },
    });
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toMatchObject({ status: 'FOUND', verificationStatus: 'NOT_CHECKED' });
    expect(Number(criteria[0]?.earnedScore)).toBe(100);
    expect(Number(criteria[0]?.normalisedWeight)).toBe(1);
    expect(Number(criteria[0]?.confidence)).toBeCloseTo(0.82, 2);

    const evidence = await ctx.prisma.evidenceItem.findMany({
      where: { candidateId: candidate?.id },
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.source).toBe('CV');
    // Pages are not stored yet, so grounding never claims one.
    expect(evidence[0]?.page).toBeNull();
    expect(evidence[0]?.criterionResultId).toBe(criteria[0]?.id);

    // Re-scoring replaces the rows instead of duplicating them.
    const job = await repository.findJobById(jobId);
    const stored = await ctx.prisma.screeningCandidate.findUnique({
      where: { id: candidate?.id as string },
    });
    if (!job || !stored) throw new Error('fixture missing');
    const rescored = await scoringService.scoreAndStore({ job, candidate: stored });

    expect(rescored).toMatchObject({ scored: true, score: 100, eligibilityStatus: 'HIGH_MATCH' });
    expect(
      await ctx.prisma.screeningCriterionResult.count({ where: { candidateId: candidate?.id } }),
    ).toBe(1);
    expect(await ctx.prisma.evidenceItem.count({ where: { candidateId: candidate?.id } })).toBe(1);
  });

  it('leaves a candidate unscored when no evidence envelope was stored', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    // A processor that returns only a summary (no envelope): nothing to score.
    setCandidateProcessor({ name: 'stub', process: async () => ({ summary: 'tanpa bukti' }) });
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const [candidate] = await candidatesOf(jobId);
    expect(candidate?.state).toBe('COMPLETED');
    expect(candidate?.score).toBeNull();
    expect(candidate?.eligibilityStatus).toBeNull();
    expect(
      await ctx.prisma.screeningCriterionResult.count({ where: { candidateId: candidate?.id } }),
    ).toBe(0);
  });

  it('ignores a redelivered candidate instead of double-charging it', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    setCandidateProcessor(passingProcessor());
    await startScreeningWorker();

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const before = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    const eventsBefore = await eventsOf(jobId);
    const [candidate] = await candidatesOf(jobId);
    expect(candidate).toBeTruthy();

    await screeningRunnerService.processCandidate({
      candidateId: candidate?.id as string,
      jobId,
      attempt: 1,
      isFinalAttempt: true,
    });

    const after = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(after?.creditsCharged).toBe(before?.creditsCharged);
    expect(after?.state).toBe('COMPLETED');
    expect(await eventsOf(jobId)).toHaveLength(eventsBefore.length);

    const balance = await wallet();
    expect(balance.body.data.balance).toBe(10 - unitCredits);
  });

  it('cancelling a queued batch fails its candidates and releases the hold', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    // No worker attached: the batch stays QUEUED, which is exactly what cancel must survive.
    await upload(jobId, ['andi.pdf', 'budi.pdf']);

    const before = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(before?.state).toBe('QUEUED');
    expect(before?.creditsReserved).toBe(unitCredits * 2);

    const response = await request(app)
      .patch(`/api/screening/jobs/${jobId}`)
      .set(bearer(session))
      .send({ state: 'CANCELLED' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.job).toMatchObject({ state: 'CANCELLED', creditsReserved: 0 });

    const candidates = await candidatesOf(jobId);
    expect(candidates.map((candidate) => candidate.state)).toEqual(['FAILED', 'FAILED']);
    expect(candidates[0]?.failureReason).toContain('dibatalkan');

    const reservation = await ctx.prisma.creditReservation.findFirst({
      where: { referenceId: jobId },
    });
    expect(reservation?.state).toBe('SETTLED');
    expect(reservation?.settledCredits).toBe(0);

    const balance = await wallet();
    expect(balance.body.data).toMatchObject({ balance: 10, reserved: 0, available: 10 });

    const progress = await request(app)
      .get(`/api/screening/jobs/${jobId}/progress`)
      .set(bearer(session));
    expect(progress.body.data.progress).toMatchObject({ finished: true, percent: 100 });
  });
});
