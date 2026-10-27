import { env } from '../config/env.js';
import { BullMqScreeningQueue } from './bullmq.queue.js';
import { InProcessScreeningQueue } from './in-process.queue.js';
import { selectQueueDriver, type ScreeningQueue } from './types.js';

export type {
  QueueDriverName,
  ScreeningCandidateJobData,
  ScreeningJobHandler,
  ScreeningQueue,
} from './types.js';
export { selectQueueDriver } from './types.js';

let instance: ScreeningQueue | null = null;

/** Builds a driver from configuration. Exported so tests can construct their own. */
export function createScreeningQueue(): ScreeningQueue {
  if (selectQueueDriver(env.REDIS_URL) === 'bullmq') {
    return new BullMqScreeningQueue({
      // `selectQueueDriver` only returns `bullmq` when the URL is present.
      url: env.REDIS_URL as string,
      concurrency: env.AI_WORKER_CONCURRENCY,
      attempts: env.SCREENING_JOB_ATTEMPTS,
      backoffMs: env.SCREENING_JOB_BACKOFF_MS,
    });
  }

  return new InProcessScreeningQueue({
    concurrency: env.AI_WORKER_CONCURRENCY,
    attempts: env.SCREENING_JOB_ATTEMPTS,
    backoffMs: env.SCREENING_JOB_BACKOFF_MS,
  });
}

export function getScreeningQueue(): ScreeningQueue {
  instance ??= createScreeningQueue();
  return instance;
}

/** Test seam: replace or clear the process-wide queue. */
export function setScreeningQueue(queue: ScreeningQueue | null): void {
  instance = queue;
}
