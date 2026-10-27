/**
 * Provider cost accounting.
 *
 * These numbers are INTERNAL ONLY. Users are never charged by token count: they pay
 * a predictable number of credits per feature (see packages/shared). Provider pricing
 * changes over time, so it is configurable rather than hardcoded into business logic.
 *
 * Rates are USD per 1,000,000 tokens and default to DeepSeek's published pricing at
 * the time of writing. Override the whole table with AI_PROVIDER_PRICING_JSON.
 */
export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedInputPerMillionUsd?: number;
}

export interface ProviderPricingConfig {
  provider: string;
  /** Exact model id -> rate. */
  models: Record<string, ModelPricing>;
  /** Rate used when a model id is not listed. */
  fallback: ModelPricing;
}

const DEFAULT_PRICING: ProviderPricingConfig = {
  provider: 'deepseek',
  models: {
    'deepseek-chat': { inputPerMillionUsd: 0.27, outputPerMillionUsd: 1.1, cachedInputPerMillionUsd: 0.07 },
    'deepseek-reasoner': { inputPerMillionUsd: 0.55, outputPerMillionUsd: 2.19, cachedInputPerMillionUsd: 0.14 },
  },
  fallback: { inputPerMillionUsd: 0.27, outputPerMillionUsd: 1.1, cachedInputPerMillionUsd: 0.07 },
};

function parseOverride(raw: string | undefined): Partial<ProviderPricingConfig> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Partial<ProviderPricingConfig>;
  } catch {
    return null;
  }
}

export function resolveProviderPricing(overrideJson?: string | undefined): ProviderPricingConfig {
  const override = parseOverride(overrideJson);
  if (!override) return DEFAULT_PRICING;
  return {
    provider: override.provider ?? DEFAULT_PRICING.provider,
    models: { ...DEFAULT_PRICING.models, ...(override.models ?? {}) },
    fallback: override.fallback ?? DEFAULT_PRICING.fallback,
  };
}

export interface UsageCostInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface UsageCost {
  estimatedCostUsd: number;
  targetRevenueUsd: number;
  pricingKnown: boolean;
}

export function computeUsageCost(
  input: UsageCostInput,
  options: { pricing?: ProviderPricingConfig; markupMultiplier?: number } = {},
): UsageCost {
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const markup = options.markupMultiplier ?? 2;
  const rate = pricing.models[input.model];
  const effective = rate ?? pricing.fallback;

  const freshInputTokens = Math.max(0, input.inputTokens - (input.cachedTokens ?? 0));
  const cost =
    (freshInputTokens / 1_000_000) * effective.inputPerMillionUsd +
    ((input.cachedTokens ?? 0) / 1_000_000) *
      (effective.cachedInputPerMillionUsd ?? effective.inputPerMillionUsd) +
    (input.outputTokens / 1_000_000) * effective.outputPerMillionUsd;

  const rounded = Math.round(cost * 1_000_000) / 1_000_000;

  return {
    estimatedCostUsd: rounded,
    targetRevenueUsd: Math.round(rounded * markup * 1_000_000) / 1_000_000,
    pricingKnown: rate !== undefined,
  };
}

export { DEFAULT_PRICING as DEFAULT_PROVIDER_PRICING };
