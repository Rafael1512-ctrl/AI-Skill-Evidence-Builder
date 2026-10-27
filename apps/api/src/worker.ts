import { env } from './config/env.js';
import { disconnectPrisma, isDatabaseConfigured } from './db/prisma.js';
import { logger } from './utils/logger.js';
import { startScreeningWorker, stopScreeningWorker } from './workers/screening.worker.js';

/**
 * Standalone screening worker.
 *
 * Required when `REDIS_URL` is set: the API enqueues and this process consumes, so AI work
 * never competes with HTTP requests. Without Redis there is nothing to consume across
 * processes, so `server.ts` attaches the in-process worker instead and this entry point
 * exits with a clear message rather than pretending to be useful.
 */

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Screening worker shutting down');
  const forceExit = setTimeout(() => {
    logger.error('Forced worker shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await stopScreeningWorker();
    await disconnectPrisma();
  } catch (error) {
    logger.error({ err: error }, 'Error while shutting the screening worker down');
    clearTimeout(forceExit);
    process.exit(1);
  }

  clearTimeout(forceExit);
  process.exit(0);
}

if (!env.REDIS_URL) {
  logger.warn(
    'REDIS_URL is not set: there is no shared queue to consume. The API process runs the screening worker in-process instead.',
  );
} else {
  await startScreeningWorker();
  logger.info(
    {
      environment: env.NODE_ENV,
      concurrency: env.AI_WORKER_CONCURRENCY,
      attempts: env.SCREENING_JOB_ATTEMPTS,
      database: isDatabaseConfigured() ? 'configured' : 'not configured',
    },
    'Screening worker connected to Redis',
  );

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection in the screening worker');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception in the screening worker');
    void shutdown('uncaughtException');
  });
}
