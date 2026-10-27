import { resetEnvCache } from '../../src/config/env.js';

/**
 * Runs a test with temporary environment variables.
 *
 * `env` is a live proxy over a memoised parse, so mutating `process.env` requires
 * invalidating the cache - and the cache must be invalidated again afterwards so a
 * test can never leak configuration into its neighbours.
 */
export async function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCache();
  }
}
