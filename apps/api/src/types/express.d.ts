import type { Logger } from 'pino';

import type { AuthContext } from '../services/auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the request-context middleware; always present. */
      requestId: string;
      /** Request-scoped logger carrying the request id. */
      log: Logger;
      /** Populated by requireAuth / optionalAuth. */
      auth: AuthContext | null;
      /** Populated by the Zod validation middleware. */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
