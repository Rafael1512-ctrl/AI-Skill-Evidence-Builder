import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

import { logger } from '../utils/logger.js';
import type { ScreeningCandidateJobData, ScreeningJobHandler, ScreeningQueue } from './types.js';

const QUEUE_NAME = 'screening-candidates';

export interface BullMqQueueOptions {
  url: string;
  concurrency: number;
  attempts: number;
  backoffMs: number;
}

/**
 * Redis-backed queue driver (BullMQ).
 *
 * Selected when `REDIS_URL` is set, which also means the API process no longer drains the
 * queue: `npm run dev:worker` (or `node dist/worker.js`) owns the handler in that
 * deployment, and any number of worker processes can share the queue.
 *
 * Retries live in BullMQ itself (`attempts` + exponential `backoff`), so the attempt
 * number handed to the handler comes from `job.attemptsMade` rather than the job payload.
 */
export class BullMqScreeningQueue implements ScreeningQueue {
  readonly driver = 'bullmq' as const;

  private readonly connection: Redis;
  private readonly queue: Queue<ScreeningCandidateJobData>;
  private worker: Worker<ScreeningCandidateJobData> | null = null;

  constructor(private readonly options: BullMqQueueOptions) {
    // BullMQ requires a connection that does not abort on the first command error.
    this.connection = new Redis(options.url, { maxRetriesPerRequest: null });
    this.queue = new Queue<ScreeningCandidateJobData>(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: options.attempts,
        backoff: { type: 'exponential', delay: options.backoffMs },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1_000 },
      },
    });
  }

  async enqueueCandidates(input: {
    jobId: string;
    candidateIds: readonly string[];
  }): Promise<void> {
    if (input.candidateIds.length === 0) return;

    await this.queue.addBulk(
      input.candidateIds.map((candidateId) => ({
        name: 'screen-candidate',
        data: { jobId: input.jobId, candidateId, attempt: 1, isFinalAttempt: false },
        opts: {
          // A stable id makes a repeated enqueue for the same candidate a no-op.
          jobId: `${input.jobId}:${candidateId}`,
          attempts: this.options.attempts,
          backoff: { type: 'exponential', delay: this.options.backoffMs },
        },
      })),
    );
  }

  async start(handler: ScreeningJobHandler): Promise<void> {
    if (this.worker) return;

    this.worker = new Worker<ScreeningCandidateJobData>(
      QUEUE_NAME,
      async (job: Job<ScreeningCandidateJobData>) => {
        const attempt = (job.attemptsMade ?? 0) + 1;
        await handler({
          ...job.data,
          attempt,
          isFinalAttempt: attempt >= this.options.attempts,
        });
      },
      { connection: this.connection, concurrency: this.options.concurrency },
    );

    this.worker.on('failed', (job, error) => {
      logger.warn(
        { err: error, jobId: job?.data.jobId, candidateId: job?.data.candidateId },
        'Screening candidate job failed',
      );
    });
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
    this.connection.disconnect();
  }

  /** Best-effort: Redis is the source of truth, so this polls until the queue looks empty. */
  async waitForIdle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const counts = await this.queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'prioritized',
        'waiting-children',
      );
      const busy = Object.values(counts).reduce((total, value) => total + value, 0);
      if (busy === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
