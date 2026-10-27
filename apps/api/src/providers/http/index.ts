import { env } from '../../config/env.js';
import { createGuardedHttpProvider } from './guarded.provider.js';
import { MockHttpProvider } from './mock.provider.js';
import type { OutboundHttpProvider } from './types.js';

let cached: OutboundHttpProvider | null = null;

/**
 * Outbound fetcher selection.
 *
 * `mock` is the default so development and the automated suite stay offline; a deployment
 * that wants real GitHub/portfolio evidence sets `OUTBOUND_HTTP_PROVIDER=guarded`. The guards
 * run in both cases, so a blocked host is refused even in mock mode.
 */
export function getOutboundHttpProvider(): OutboundHttpProvider {
  cached ??=
    env.OUTBOUND_HTTP_PROVIDER === 'guarded' ? createGuardedHttpProvider() : new MockHttpProvider();
  return cached;
}

/** Test hook: inject a provider (e.g. one with canned pages). */
export function setOutboundHttpProviderForTests(provider: OutboundHttpProvider | null): void {
  cached = provider;
}

export {
  MAX_REDIRECTS,
  assertContentTypeAllowed,
  assertUrlAllowed,
  classifyLinkHost,
  htmlToText,
  isBlockedAddress,
} from './guards.js';
export { GuardedHttpProvider } from './guarded.provider.js';
export { MockHttpProvider } from './mock.provider.js';
export type { OutboundFetchInput, OutboundFetchResult, OutboundHttpProvider } from './types.js';
