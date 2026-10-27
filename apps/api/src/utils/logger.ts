import { pino, type Logger } from 'pino';

import { env } from '../config/env.js';

/**
 * Application logger.
 *
 * Sensitive material is redacted centrally: never log CV contents, tokens, service
 * keys or payment credentials.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-webhook-signature"]',
  'req.body.password',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.cvText',
  'res.headers["set-cookie"]',
  'password',
  'accessToken',
  'refreshToken',
  'apiKey',
  'serverKey',
  'serviceRoleKey',
];

export function createLogger(name = 'aseb-api'): Logger {
  const pretty = env.isDevelopment;
  return pino({
    name,
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: '[redacted]' },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

export const logger: Logger = createLogger();

export type { Logger };
