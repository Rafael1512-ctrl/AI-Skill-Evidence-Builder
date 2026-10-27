/**
 * Test-facing export of the Express app.
 *
 * `server.ts` starts listening on import, which tests must not do; this module builds
 * the same app without binding a port.
 */
import { createApp } from './app.js';

export const app = createApp();
