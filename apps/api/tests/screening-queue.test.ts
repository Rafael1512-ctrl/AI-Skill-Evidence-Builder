import { describe, expect, it } from 'vitest';

import { InProcessScreeningQueue } from '../src/queues/in-process.queue.js';
import { selectQueueDriver } from '../src/queues/types.js';
import {
  deriveJobOutcome,
  resolveCandidateProcessor,
} from '../src/services/screening-runner.service.js';
import {
  getCandidateProcessorOverride,
  setCandidateProcessor,
} from '../src/workers/screening.processor.js';

/**
 * Queue mechanics. Pure and offline: no Redis, no database and no sockets.
 *
 * The in-process driver is what runs when `REDIS_URL` is unset (development, tests), so its
 * retry/backoff/idle semantics are the ones most likely to regress unnoticed.
 */

function makeQueue(
  overrides: Partial<{ concurrency: number; attempts: number; backoffMs: number }> = {},
) {
  return new InProcessScreeningQueue({
    concurrency: 2,
    attempts: 3,
    backoffMs: 5,
    ...overrides,
  });
}

const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('queue driver selection', () => {
  it('uses BullMQ only when a Redis URL is configured', () => {
    expect(selectQueueDriver('redis://localhost:6379')).toBe('bullmq');
    expect(selectQueueDriver(undefined)).toBe('in-process');
    expect(selectQueueDriver('')).toBe('in-process');
    expect(selectQueueDriver('   ')).toBe('in-process');
  });
});

describe('in-process screening queue', () => {
  it('runs every enqueued candidate through the handler', async () => {
    const queue = makeQueue();
    const seen: string[] = [];
    await queue.start(async (data) => {
      seen.push(data.candidateId);
    });

    await queue.enqueueCandidates({ jobId: 'job_1', candidateIds: ['a', 'b', 'c'] });
    await queue.waitForIdle();

    expect(seen.sort()).toEqual(['a', 'b', 'c']);
    await queue.stop();
  });

  it('keeps jobs pending until a handler is attached', async () => {
    const queue = makeQueue();
    const seen: string[] = [];

    await queue.enqueueCandidates({ jobId: 'job_1', candidateIds: ['a'] });
    await tick();
    expect(seen).toEqual([]);

    await queue.start(async (data) => {
      seen.push(data.candidateId);
    });
    await queue.waitForIdle();
    expect(seen).toEqual(['a']);
    await queue.stop();
  });

  it('never exceeds the configured concurrency', async () => {
    const queue = makeQueue({ concurrency: 2, attempts: 1 });
    let active = 0;
    let peak = 0;

    await queue.start(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick();
      active -= 1;
    });

    await queue.enqueueCandidates({ jobId: 'job_1', candidateIds: ['a', 'b', 'c', 'd', 'e'] });
    await queue.waitForIdle();

    expect(peak).toBe(2);
    await queue.stop();
  });

  it('retries with exponential backoff and stops on the final attempt', async () => {
    const queue = makeQueue({ attempts: 3, backoffMs: 5 });
    const attempts: number[] = [];
    const finalFlags: boolean[] = [];

    await queue.start(async (data) => {
      attempts.push(data.attempt);
      finalFlags.push(data.isFinalAttempt);
      throw new Error('boom');
    });

    await queue.enqueueCandidates({ jobId: 'job_1', candidateIds: ['cand_1'] });
    await queue.waitForIdle();

    expect(attempts).toEqual([1, 2, 3]);
    expect(finalFlags).toEqual([false, false, true]);
    await queue.stop();
  });

  it('stops retrying once an attempt succeeds', async () => {
    const queue = makeQueue({ attempts: 3, backoffMs: 5 });
    const attempts: number[] = [];

    await queue.start(async (data) => {
      attempts.push(data.attempt);
      if (data.attempt === 1) throw new Error('transient');
    });

    await queue.enqueueCandidates({ jobId: 'job_1', candidateIds: ['cand_1'] });
    await queue.waitForIdle();

    expect(attempts).toEqual([1, 2]);
    await queue.stop();
  });

  it('abandons pending work on stop so shutdown cannot hang', async () => {
    const queue = makeQueue();
    await queue.enqueueCandidates({ jobId: 'job_1', candidateIds: ['a', 'b'] });

    await queue.stop();
    // Reaching this line is the assertion: waitForIdle must not block forever.
    await queue.waitForIdle();
  });
});

describe('batch outcome', () => {
  it('waits while any candidate is still queued or running', () => {
    expect(deriveJobOutcome({ queued: 1, processing: 0, completed: 3, failed: 0 })).toBeNull();
    expect(deriveJobOutcome({ queued: 0, processing: 1, completed: 3, failed: 0 })).toBeNull();
  });

  it('distinguishes complete, partial and failed batches', () => {
    expect(deriveJobOutcome({ queued: 0, processing: 0, completed: 3, failed: 0 })).toBe(
      'COMPLETED',
    );
    expect(deriveJobOutcome({ queued: 0, processing: 0, completed: 2, failed: 1 })).toBe(
      'PARTIALLY_COMPLETED',
    );
    expect(deriveJobOutcome({ queued: 0, processing: 0, completed: 0, failed: 3 })).toBe('FAILED');
  });

  it('reports nothing to finalise for an empty batch', () => {
    expect(deriveJobOutcome({ queued: 0, processing: 0, completed: 0, failed: 0 })).toBeNull();
  });
});

describe('candidate processor seam', () => {
  it('defaults to evidence extraction and honours a test override', () => {
    setCandidateProcessor(null);
    expect(getCandidateProcessorOverride()).toBeNull();
    expect(resolveCandidateProcessor().name).toBe('HRD_EVIDENCE_EXTRACTION_V1');

    const stub = { name: 'stub', process: async () => ({ summary: 'ok' }) };
    setCandidateProcessor(stub);
    expect(getCandidateProcessorOverride()).toBe(stub);
    expect(resolveCandidateProcessor()).toBe(stub);

    setCandidateProcessor(null);
    expect(resolveCandidateProcessor().name).toBe('HRD_EVIDENCE_EXTRACTION_V1');
  });
});
