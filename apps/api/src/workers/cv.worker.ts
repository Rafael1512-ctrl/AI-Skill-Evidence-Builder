import { getCvProcessingQueue } from '../queues/cv-processing.queue.js';
import { cvAuditService } from '../services/cv-audit.service.js';
import { cvEnhancementService } from '../services/cv-enhancement.service.js';
import { logger } from '../utils/logger.js';

/**
 * Attaches job-seeker CV work to the configured queue.
 *
 * With Redis this runs in the standalone worker process; without Redis the API process
 * hosts the same in-process driver. The handler only receives durable ids.
 */
export async function startCvWorker(): Promise<void> {
  const queue = getCvProcessingQueue();
  await queue.start(async (job) => {
    if (job.kind === 'AUDIT') {
      await cvAuditService.processAudit(job.id, job.isFinalAttempt);
      return;
    }
    await cvEnhancementService.processEnhancement(job.id, job.isFinalAttempt);
  });
  logger.info({ driver: queue.driver }, 'CV processing worker started');
}

export async function stopCvWorker(): Promise<void> {
  await getCvProcessingQueue().stop();
}
