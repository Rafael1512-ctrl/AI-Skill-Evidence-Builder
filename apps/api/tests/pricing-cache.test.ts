import { describe, expect, it } from 'vitest';

import type { FeaturePricing } from '../src/generated/prisma/client.js';
import type { PricingRepository } from '../src/repositories/pricing.repository.js';
import { PricingService } from '../src/services/pricing.service.js';

/**
 * Pricing cache semantics (Phase 23).
 *
 * The service memoises `FeaturePricing` overrides for 30 seconds in a process-wide singleton,
 * which is right for serving traffic and wrong for tests that truncate the table between files:
 * an override written by one suite leaked into the next one through the cache (a 7-credit
 * enhancement override made a 5-credit enhancement look unaffordable elsewhere). These tests pin
 * the mechanism - a write invalidates the cache, and `invalidate()` forces a re-read - so the
 * harness's `pricingService.invalidate()` on reset is provably the right hook.
 */

function row(feature: string, credits: number): FeaturePricing {
  return {
    id: `row-${feature}`,
    feature,
    credits,
    updatedByUserId: null,
    createdAt: new Date('2026-09-26T00:00:00.000Z'),
    updatedAt: new Date('2026-09-26T00:00:00.000Z'),
  };
}

function fakeRepository(initial: FeaturePricing[] = []) {
  const rows = [...initial];
  let reads = 0;

  const repository = {
    async findAll() {
      reads += 1;
      return rows;
    },
    async upsert(feature: string, credits: number) {
      const existing = rows.findIndex((entry) => entry.feature === feature);
      const updated = row(feature, credits);
      if (existing >= 0) rows[existing] = updated;
      else rows.push(updated);
      return updated;
    },
  } as unknown as PricingRepository;

  return { repository, rows, reads: () => reads };
}

describe('pricing cache', () => {
  it('serves defaults when no override exists and caches the lookup', async () => {
    const fake = fakeRepository();
    const service = new PricingService(fake.repository);

    expect(await service.resolve('CV_ENHANCEMENT')).toBe(5);
    await service.resolve('CV_ENHANCEMENT');

    // One read for two resolutions: the cache is doing its job.
    expect(fake.reads()).toBe(1);
  });

  it('applies an admin override immediately, without waiting for the TTL', async () => {
    const fake = fakeRepository();
    const service = new PricingService(fake.repository);

    await service.resolve('CV_ENHANCEMENT');
    await service.update('CV_ENHANCEMENT', 7, 'admin-1');

    expect(await service.resolve('CV_ENHANCEMENT')).toBe(7);
  });

  it('re-reads the table after invalidate, which is what a database reset must do', async () => {
    const fake = fakeRepository([row('CV_ENHANCEMENT', 7)]);
    const service = new PricingService(fake.repository);

    expect(await service.resolve('CV_ENHANCEMENT')).toBe(7);

    // The table is truncated behind the service's back (as `ctx.db.reset()` does) and the cache is
    // cleared, so the next resolution must fall back to the shared default.
    fake.rows.length = 0;
    service.invalidate();

    expect(await service.resolve('CV_ENHANCEMENT')).toBe(5);
  });

  it('reflects a row deleted behind its back once invalidated', async () => {
    const fake = fakeRepository([row('HRD_SCREEN_PER_CV', 9)]);
    const service = new PricingService(fake.repository);

    expect(await service.resolve('HRD_SCREEN_PER_CV')).toBe(9);
    fake.rows.length = 0;
    service.invalidate();

    expect(await service.resolve('HRD_SCREEN_PER_CV')).toBe(1);
  });
});
