import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const QUEUE_NAME = 'cv-processing';

export type CvProcessingJobKind = 'AUDIT' | 'ENHANCEMENT';
export type QueueDriverName = 'bullmq' | 'in-process';

export interface CvProcessingJobData {
  kind: CvProcessingJobKind;
  id: string;
  attempt: number;
  isFinalAttempt: boolean;
}

export type CvProcessingHandler = (data: CvProcessingJobData) => Promise<void>;

/**
 * Durable background work for job-seeker CV features.
 *
 * Only ids cross the queue boundary. The PDF text and request options are already stored
 * before enqueueing, so a refreshed browser can reconnect through the status API and a
 * worker restart can retry without another upload.
 */
export interface CvProcessingQueue {
  readonly driver: QueueDriverName;
  enqueue(input: { kind: CvProcessingJobKind; id: string }): Promise<void>;
  start(handler: CvProcessingHandler): Promise<void>;
  stop(): Promise<void>;
  waitForIdle(): Promise<void>;
}

interface QueueOptions {
  concurrency: number;
  attempts: number;
  backoffMs: number;
}

function jobKey(kind: CvProcessingJobKind, id: string): string {
  return `${kind}:${id}`;
}

export class InProcessCvProcessingQueue implements CvProcessingQueue {
  readonly driver = 'in-process' as const;

  private handler: CvProcessingHandler | null = null;
  private pending: CvProcessingJobData[] = [];
  private retryTimers = new Set<NodeJS.Timeout>();
  private active = 0;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: QueueOptions) {}

  async enqueue(input: { kind: CvProcessingJobKind; id: string }): Promise<void> {
    const duplicate = this.pending.some((job) => job.kind === input.kind && job.id === input.id);
    if (duplicate) return;

    this.pending.push({
      ...input,
      attempt: 1,
      isFinalAttempt: this.options.attempts <= 1,
    });
    this.pump();
  }

  async start(handler: CvProcessingHandler): Promise<void> {
    this.handler = handler;
    this.stopped = false;
    this.pump();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    this.pending = [];
    this.settleIfIdle();
  }

  async waitForIdle(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && this.active === 0 && this.retryTimers.size === 0;
  }

  private settleIfIdle(): void {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private pump(): void {
    if (this.stopped || !this.handler) {
      this.settleIfIdle();
      return;
    }

    while (this.active < this.options.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.active += 1;
      void this.run(this.handler, job);
    }
    this.settleIfIdle();
  }

  private async run(handler: CvProcessingHandler, job: CvProcessingJobData): Promise<void> {
    try {
      await handler(job);
    } catch (error) {
      if (job.attempt < this.options.attempts) {
        this.scheduleRetry(job);
      } else {
        logger.error(
          { err: error, kind: job.kind, jobId: job.id, attempt: job.attempt },
          'CV processing job failed on its final attempt',
        );
      }
    } finally {
      this.active -= 1;
      this.pump();
    }
  }

  private scheduleRetry(job: CvProcessingJobData): void {
    const delay = this.options.backoffMs * 2 ** (job.attempt - 1);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      const nextAttempt = job.attempt + 1;
      this.pending.push({
        ...job,
        attempt: nextAttempt,
        isFinalAttempt: nextAttempt >= this.options.attempts,
      });
      this.pump();
    }, delay);
    this.retryTimers.add(timer);
  }
}

export class BullMqCvProcessingQueue implements CvProcessingQueue {
  readonly driver = 'bullmq' as const;

  private readonly connection: Redis;
  private readonly queue: Queue<CvProcessingJobData>;
  private worker: Worker<CvProcessingJobData> | null = null;

  constructor(
    url: string,
    private readonly options: QueueOptions,
  ) {
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue<CvProcessingJobData>(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: options.attempts,
        backoff: { type: 'exponential', delay: options.backoffMs },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1_000 },
      },
    });
  }

  async enqueue(input: { kind: CvProcessingJobKind; id: string }): Promise<void> {
    await this.queue.add(
      'process-cv',
      {
        ...input,
        attempt: 1,
        isFinalAttempt: this.options.attempts <= 1,
      },
      {
        jobId: jobKey(input.kind, input.id),
        attempts: this.options.attempts,
        backoff: { type: 'exponential', delay: this.options.backoffMs },
      },
    );
  }

  async start(handler: CvProcessingHandler): Promise<void> {
    if (this.worker) return;

    this.worker = new Worker<CvProcessingJobData>(
      QUEUE_NAME,
      async (job: Job<CvProcessingJobData>) => {
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
        { err: error, kind: job?.data.kind, jobId: job?.data.id },
        'CV processing job failed',
      );
    });
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
    this.connection.disconnect();
  }

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

let instance: CvProcessingQueue | null = null;

export function createCvProcessingQueue(): CvProcessingQueue {
  const options = {
    concurrency: env.AI_WORKER_CONCURRENCY,
    attempts: env.CV_JOB_ATTEMPTS,
    backoffMs: env.CV_JOB_BACKOFF_MS,
  };

  return env.REDIS_URL
    ? new BullMqCvProcessingQueue(env.REDIS_URL, options)
    : new InProcessCvProcessingQueue(options);
}

export function getCvProcessingQueue(): CvProcessingQueue {
  instance ??= createCvProcessingQueue();
  return instance;
}

/** Test seam: replace or clear the process-wide queue. */
export function setCvProcessingQueue(queue: CvProcessingQueue | null): void {
  instance = queue;
}
