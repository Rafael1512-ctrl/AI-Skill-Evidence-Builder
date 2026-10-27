import {
  DEFAULT_FEATURE_PRICING,
  FEATURE_KEYS,
  MAX_FEATURE_CREDIT_COST,
  type FeatureKey,
  type FeaturePricing as FeaturePricingDto,
} from '@aseb/shared';

import type { FeaturePricing } from '../generated/prisma/client.js';
import { PricingRepository } from '../repositories/pricing.repository.js';
import { AppError } from '../utils/errors.js';

const CACHE_TTL_MS = 30_000;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function assertFeatureKey(value: string): FeatureKey {
  if (!isFeatureKey(value)) {
    throw AppError.validation({ feature: value }, `Fitur "${value}" tidak dikenal.`);
  }
  return value;
}

/**
 * Feature pricing is product-facing and predictable.
 *
 * Defaults live in @aseb/shared; an admin-editable override lives in the
 * FeaturePricing table. Nothing else in the codebase may hardcode a credit cost.
 */
export class PricingService {
  private cache: { loadedAt: number; overrides: Map<FeatureKey, { credits: number; updatedAt: Date }> } | null =
    null;

  constructor(private readonly repository = new PricingRepository()) {}

  private async loadOverrides(): Promise<Map<FeatureKey, { credits: number; updatedAt: Date }>> {
    const now = Date.now();
    if (this.cache && now - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.overrides;
    }

    const rows: FeaturePricing[] = await this.repository.findAll();
    const overrides = new Map<FeatureKey, { credits: number; updatedAt: Date }>();
    for (const row of rows) {
      if (isFeatureKey(row.feature)) {
        overrides.set(row.feature, { credits: row.credits, updatedAt: row.updatedAt });
      }
    }

    this.cache = { loadedAt: now, overrides };
    return overrides;
  }

  /** Credit cost of a single unit of a feature. */
  async resolve(feature: FeatureKey): Promise<number> {
    const overrides = await this.loadOverrides();
    return overrides.get(feature)?.credits ?? DEFAULT_FEATURE_PRICING[feature].credits;
  }

  /** Total credit cost for `quantity` units, e.g. 12 CVs in a screening batch. */
  async resolveTotal(feature: FeatureKey, quantity: number): Promise<number> {
    const unit = await this.resolve(feature);
    return unit * Math.max(1, quantity);
  }

  async listAll(): Promise<FeaturePricingDto[]> {
    const overrides = await this.loadOverrides();
    return FEATURE_KEYS.map((feature) => {
      const definition = DEFAULT_FEATURE_PRICING[feature];
      const override = overrides.get(feature);
      return {
        feature,
        credits: override?.credits ?? definition.credits,
        label: definition.label,
        description: definition.description,
        isOverride: override !== undefined,
        sortOrder: definition.sortOrder,
        updatedAt: override ? override.updatedAt.toISOString() : null,
      };
    }).sort((left, right) => left.sortOrder - right.sortOrder);
  }

  /** Admin-only pricing change. Values are validated against the shared guard rails. */
  async update(feature: string, credits: number, updatedByUserId: string): Promise<FeaturePricingDto> {
    const key = assertFeatureKey(feature);
    if (!Number.isInteger(credits) || credits < 0 || credits > MAX_FEATURE_CREDIT_COST) {
      throw AppError.validation(
        { credits },
        `Biaya kredit harus berupa bilangan bulat antara 0 dan ${MAX_FEATURE_CREDIT_COST}.`,
      );
    }

    await this.repository.upsert(key, credits, updatedByUserId);
    this.invalidate();
    const all = await this.listAll();
    const updated = all.find((item) => item.feature === key);
    if (!updated) throw AppError.internal(new Error(`Pricing row missing after update: ${key}`));
    return updated;
  }

  invalidate(): void {
    this.cache = null;
  }
}

export const pricingService = new PricingService();
