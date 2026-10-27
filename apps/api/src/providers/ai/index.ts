import { env } from '../../config/env.js';
import { createDeepSeekProvider } from './deepseek.provider.js';
import { MockAIProvider } from './mock.provider.js';
import type { AIProvider } from './types.js';

let cached: AIProvider | null = null;

/**
 * Provider selection.
 *
 * `AI_PROVIDER=mock` is fully offline and is what development and the automated test
 * suite use. With `deepseek`, configuration problems surface immediately with an
 * actionable message instead of failing later inside a request.
 */
export function getAiProvider(): AIProvider {
  if (cached) return cached;

  cached =
    env.AI_PROVIDER === 'mock'
      ? new MockAIProvider()
      : createDeepSeekProvider({
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: env.DEEPSEEK_BASE_URL,
          model: env.DEEPSEEK_MODEL,
          fallbackModels: env.DEEPSEEK_FALLBACK_MODELS,
          timeoutMs: env.DEEPSEEK_TIMEOUT_MS,
          markupMultiplier: env.AI_MARKUP_MULTIPLIER,
          pricingOverrideJson: process.env.AI_PROVIDER_PRICING_JSON,
        });

  return cached;
}

/** Test hook: replace the provider (e.g. to inject a failing provider). */
export function setAiProviderForTests(provider: AIProvider | null): void {
  cached = provider;
}

export function getMockProvider(): MockAIProvider {
  const provider = getAiProvider();
  if (!(provider instanceof MockAIProvider)) {
    throw new Error('The active AI provider is not the mock provider.');
  }
  return provider;
}

export type { AIProvider } from './types.js';
export { MockAIProvider } from './mock.provider.js';
export { DeepSeekProvider } from './deepseek.provider.js';
