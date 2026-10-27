import { getScreeningQueue } from '../queues/index.js';
import { screeningRunnerService } from '../services/screening-runner.service.js';
import { logger } from '../utils/logger.js';

/**
 * Attaches the screening handler to whichever queue driver is configured.
 *
 * With Redis this runs in the dedicated worker process (`npm run dev:worker`); without it
 * the API process itself drains the queue, which is what keeps local development and the
 * test suite broker-free.
 */
export async function startScreeningWorker(): Promise<void> {
  const queue = getScreeningQueue();
  await queue.start((data) => screeningRunnerService.processCandidate(data));
  logger.info({ driver: queue.driver }, 'Screening worker started');
}

export async function stopScreeningWorker(): Promise<void> {
  await getScreeningQueue().stop();
}
