import { logger } from '../utils/logger.js';
import type { ScreeningCandidateJobData, ScreeningJobHandler, ScreeningQueue } from './types.js';

export interface InProcessQueueOptions {
  /** How many candidates may be processed at once. */
  concurrency: number;
  /** Total attempts per candidate, matching the BullMQ driver's configuration. */
  attempts: number;
  /** Base delay for exponential backoff between attempts. */
  backoffMs: number;
}

/**
 * In-process queue driver.
 *
 * Used when `REDIS_URL` is unset: the API process itself drains the queue. It mirrors the
 * BullMQ configuration (bounded concurrency, attempt count, exponential backoff) so
 * switching brokers does not change behaviour, and exposes `waitForIdle` so tests can run
 * to completion deterministically.
 */
export class InProcessScreeningQueue implements ScreeningQueue {
  readonly driver = 'in-process' as const;

  private handler: ScreeningJobHandler | null = null;
  private pending: ScreeningCandidateJobData[] = [];
  private retryTimers = new Set<NodeJS.Timeout>();
  private active = 0;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: InProcessQueueOptions) {}

  async enqueueCandidates(input: {
    jobId: string;
    candidateIds: readonly string[];
  }): Promise<void> {
    for (const candidateId of input.candidateIds) {
      this.pending.push(this.newJobData(input.jobId, candidateId, 1));
    }
    this.pump();
  }

  async start(handler: ScreeningJobHandler): Promise<void> {
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

  private newJobData(
    jobId: string,
    candidateId: string,
    attempt: number,
  ): ScreeningCandidateJobData {
    return {
      jobId,
      candidateId,
      attempt,
      isFinalAttempt: attempt >= this.options.attempts,
    };
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
    if (this.stopped) return;

    const handler = this.handler;
    if (handler) {
      while (this.active < this.options.concurrency && this.pending.length > 0) {
        const task = this.pending.shift();
        if (!task) break;
        this.active += 1;
        void this.run(handler, task);
      }
    }

    this.settleIfIdle();
  }

  private async run(handler: ScreeningJobHandler, task: ScreeningCandidateJobData): Promise<void> {
    try {
      await handler(task);
    } catch (error) {
      // The handler only throws when it wants a retry, so a non-final attempt is scheduled
      // again; the final attempt has already recorded its own failure.
      if (task.attempt < this.options.attempts) {
        this.scheduleRetry(task);
      } else {
        logger.error(
          { err: error, candidateId: task.candidateId, attempt: task.attempt },
          'Screening candidate failed on its final attempt',
        );
      }
    } finally {
      this.active -= 1;
      this.pump();
    }
  }

  private scheduleRetry(task: ScreeningCandidateJobData): void {
    const delay = this.options.backoffMs * 2 ** (task.attempt - 1);
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      this.pending.push(this.newJobData(task.jobId, task.candidateId, task.attempt + 1));
      this.pump();
    }, delay);

    this.retryTimers.add(timer);
  }
}
