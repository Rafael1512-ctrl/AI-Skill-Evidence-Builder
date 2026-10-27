import { MAX_FEATURE_CREDIT_COST } from '@aseb/shared';
import type { PricingService } from '../src/services/pricing.service.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * Feature pricing persistence and fallback.
 *
 * Defaults live in @aseb/shared; the `feature_pricing` table only stores admin
 * overrides. These tests prove an override survives a round-trip, that unset
 * features keep their default, and that the cache is invalidated on write.
 */
describe('feature pricing', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let pricingService: PricingService;
  let adminId: string;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ pricingService } = await import('../src/services/pricing.service.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    pricingService.invalidate();
    const admin = await ctx.prisma.user.create({
      data: { email: `admin-${Date.now()}@example.com`, role: 'ADMIN' },
    });
    adminId = admin.id;
  });

  it('falls back to the shared default when no override exists', async () => {
    expect(await pricingService.resolve('CV_ENHANCEMENT')).toBe(5);
    expect(await pricingService.resolve('FREE_CV_AUDIT')).toBe(0);

    const rows = await ctx.prisma.featurePricing.count();
    expect(rows).toBe(0);
  });

  it('persists an override and reads it back', async () => {
    const updated = await pricingService.update('CV_ENHANCEMENT', 8, adminId);

    expect(updated).toMatchObject({ feature: 'CV_ENHANCEMENT', credits: 8, isOverride: true });

    const stored = await ctx.prisma.featurePricing.findUniqueOrThrow({
      where: { feature: 'CV_ENHANCEMENT' },
    });
    expect(stored.credits).toBe(8);
    expect(stored.updatedByUserId).toBe(adminId);

    expect(await pricingService.resolve('CV_ENHANCEMENT')).toBe(8);
  });

  it('merges overrides over defaults in the admin list', async () => {
    await pricingService.update('HRD_SCREEN_PER_CV', 3, adminId);
    pricingService.invalidate();

    const list = await pricingService.listAll();
    const screening = list.find((item) => item.feature === 'HRD_SCREEN_PER_CV');
    const payment = list.find((item) => item.feature === 'CV_PDF_EXPORT');

    expect(screening).toMatchObject({ credits: 3, isOverride: true });
    expect(payment).toMatchObject({ credits: 1, isOverride: false });
    expect(list).toHaveLength(7);
  });

  it('treats the override as upsert, not append', async () => {
    await pricingService.update('CV_REGENERATE', 4, adminId);
    await pricingService.update('CV_REGENERATE', 6, adminId);

    expect(await ctx.prisma.featurePricing.count({ where: { feature: 'CV_REGENERATE' } })).toBe(1);
    expect(await pricingService.resolve('CV_REGENERATE')).toBe(6);
  });

  it('caches overrides until invalidated', async () => {
    await pricingService.update('EVIDENCE_VERIFICATION', 2, adminId);
    expect(await pricingService.resolve('EVIDENCE_VERIFICATION')).toBe(2);

    // A direct write (bypassing the service) is invisible while the cache is warm...
    await ctx.prisma.featurePricing.update({
      where: { feature: 'EVIDENCE_VERIFICATION' },
      data: { credits: 9 },
    });
    expect(await pricingService.resolve('EVIDENCE_VERIFICATION')).toBe(2);

    // ...and visible once the service is invalidated.
    pricingService.invalidate();
    expect(await pricingService.resolve('EVIDENCE_VERIFICATION')).toBe(9);
  });

  it('rejects unknown features and out-of-range credit values', async () => {
    await expect(pricingService.update('NOT_A_FEATURE', 1, adminId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(pricingService.update('CV_ENHANCEMENT', -1, adminId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(pricingService.update('CV_ENHANCEMENT', 3.5, adminId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      pricingService.update('CV_ENHANCEMENT', MAX_FEATURE_CREDIT_COST + 1, adminId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await ctx.prisma.featurePricing.count()).toBe(0);
  });

  it('multiplies the unit price for batches, never below one unit', async () => {
    expect(await pricingService.resolveTotal('HRD_SCREEN_PER_CV', 12)).toBe(12);
    expect(await pricingService.resolveTotal('HRD_SCREEN_PER_CV', 0)).toBe(1);
    expect(await pricingService.resolveTotal('FREE_CV_AUDIT', 50)).toBe(0);
  });
});
