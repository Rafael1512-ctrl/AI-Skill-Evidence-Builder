import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma, isDatabaseConfigured } from './db/prisma.js';
import { logger } from './utils/logger.js';
import { startScreeningWorker, stopScreeningWorker } from './workers/screening.worker.js';

/**
 * Process entry point.
 *
 * Configuration problems are reported loudly at startup (and are fatal in production),
 * so a misconfigured deployment fails immediately instead of during a user request.
 */
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      environment: env.NODE_ENV,
      aiProvider: env.AI_PROVIDER,
      paymentProvider: env.PAYMENT_PROVIDER,
      database: isDatabaseConfigured() ? 'configured' : 'not configured',
      queue: env.REDIS_URL ? 'bullmq' : 'in-process',
    },
    `API listening on http://localhost:${env.PORT}`,
  );

  for (const warning of env.warnings) {
    logger.warn(warning);
  }

  // Without Redis there is no shared queue to consume, so this process drains it itself.
  if (!env.REDIS_URL) {
    void startScreeningWorker().catch((error: unknown) => {
      logger.error({ err: error }, 'Could not start the in-process screening worker');
    });
  }
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'Error while closing the HTTP server');
    try {
      await stopScreeningWorker();
    } catch (workerError) {
      logger.error({ err: workerError }, 'Error while stopping the screening worker');
    }
    try {
      await disconnectPrisma();
    } catch (disconnectError) {
      logger.error({ err: disconnectError }, 'Error while disconnecting from the database');
    }
    clearTimeout(forceExit);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

export { app, server };
