import type { CreditService } from '../src/services/credit.service.js';
import type { PricingService } from '../src/services/pricing.service.js';
import { AppError } from '../src/utils/errors.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * Credit accounting tests.
 *
 * These run against real PostgreSQL semantics (PGlite), so the conditional UPDATE
 * guard, the ledger rows and the reservation lifecycle are all genuinely exercised.
 */
describe('credit ledger', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let creditService: CreditService;
  let pricingService: PricingService;
  let userId: string;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ creditService } = await import('../src/services/credit.service.js'));
    ({ pricingService } = await import('../src/services/pricing.service.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    pricingService.invalidate();
    const user = await ctx.prisma.user.create({
      data: { email: `ledger-${Date.now()}@example.com`, fullName: 'Ledger Tester' },
    });
    userId = user.id;
  });

  async function topUp(credits: number, reference = `pay-${Math.random()}`) {
    return creditService.grantTopUp({
      userId,
      credits,
      amountIdr: credits * 1000,
      paymentTransactionId: reference,
    });
  }

  it('starts with an empty wallet and available = 0', async () => {
    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(0);
    expect(wallet.reserved).toBe(0);
    expect(wallet.available).toBe(0);
  });

  it('grants a top-up and records a traceable ledger row', async () => {
    const transaction = await topUp(50, 'pay-1');

    expect(transaction.type).toBe('TOP_UP');
    expect(transaction.amount).toBe(50);
    expect(transaction.balanceAfter).toBe(50);

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(50);
    expect(wallet.available).toBe(50);
    expect(wallet.lifetimeCreditsIn).toBe(50);
  });

  it('is idempotent for a repeated payment reference', async () => {
    await topUp(50, 'pay-duplicate');
    await topUp(50, 'pay-duplicate');

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(50);

    const transactions = await creditService.listTransactions({ userId, page: 1, pageSize: 10 });
    expect(transactions.items).toHaveLength(1);
  });

  it('reserves credits without changing the owned balance', async () => {
    await topUp(10);
    const reservation = await creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' });

    expect(reservation.reservedCredits).toBe(5);
    expect(reservation.state).toBe('ACTIVE');

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(10);
    expect(wallet.reserved).toBe(5);
    expect(wallet.available).toBe(5);

    // Reservations are holds, not charges: no USAGE line exists yet.
    const transactions = await creditService.listTransactions({ userId, page: 1, pageSize: 10 });
    expect(transactions.items.map((item) => item.type)).toEqual(['TOP_UP']);
  });

  it('refuses a reservation the user cannot afford', async () => {
    await topUp(4);

    await expect(creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(4);
    expect(wallet.reserved).toBe(0);
  });

  it('charges the exact amount on settlement and releases the remainder', async () => {
    await topUp(20);
    const reservation = await creditService.reserve({ userId, feature: 'HRD_SCREEN_PER_CV', quantity: 10 });

    expect(reservation.reservedCredits).toBe(10);

    const result = await creditService.settle({
      reservationId: reservation.id,
      quantity: 7, // only 7 of 10 CVs were billable
      description: 'Screening 7 dari 10 CV',
    });

    expect(result.charged).toBe(7);
    expect(result.released).toBe(3);

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(13);
    expect(wallet.reserved).toBe(0);
    expect(wallet.available).toBe(13);
    expect(wallet.lifetimeCreditsSpent).toBe(7);

    const transactions = await creditService.listTransactions({ userId, page: 1, pageSize: 10 });
    expect(transactions.items[0]).toMatchObject({ type: 'USAGE', amount: -7, balanceAfter: 13 });
  });

  it('never charges more than the reservation holds', async () => {
    await topUp(20);
    const reservation = await creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' });

    const result = await creditService.settle({
      reservationId: reservation.id,
      credits: 999,
      description: 'Attempted overcharge',
    });

    expect(result.charged).toBe(5);
    expect((await creditService.getWallet(userId)).balance).toBe(15);
  });

  it('is idempotent when settled twice', async () => {
    await topUp(20);
    const reservation = await creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' });

    const first = await creditService.settle({ reservationId: reservation.id, quantity: 1, description: 'Settle' });
    const second = await creditService.settle({ reservationId: reservation.id, quantity: 1, description: 'Settle' });

    expect(first.alreadySettled).toBe(false);
    expect(second.alreadySettled).toBe(true);
    expect((await creditService.getWallet(userId)).balance).toBe(15);

    const transactions = await creditService.listTransactions({ userId, page: 1, pageSize: 10 });
    expect(transactions.items.filter((item) => item.type === 'USAGE')).toHaveLength(1);
  });

  it('releases a reservation when the work fails before billing', async () => {
    await topUp(10);
    const reservation = await creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' });

    const released = await creditService.release(reservation.id, 'AI provider failed');
    expect(released.released).toBe(5);

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(10);
    expect(wallet.reserved).toBe(0);

    // Releasing twice is a no-op.
    const again = await creditService.release(reservation.id, 'AI provider failed');
    expect(again.alreadyReleased).toBe(true);
    expect((await creditService.getWallet(userId)).reserved).toBe(0);
  });

  it('cannot overspend when reservations arrive concurrently', async () => {
    await topUp(10);

    // 10 available, each reservation wants 5: exactly two may succeed.
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' })),
    );

    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(3);

    const wallet = await creditService.getWallet(userId);
    expect(wallet.reserved).toBe(10);
    expect(wallet.available).toBe(0);
    expect(wallet.balance).toBe(10);
  });

  it('never lets a refund or adjustment drive the wallet negative', async () => {
    await topUp(5);
    const admin = await ctx.prisma.user.create({ data: { email: `admin-${Date.now()}@example.com` } });

    await expect(
      creditService.adjust({ userId, amount: -50, reason: 'Correction', adminUserId: admin.id }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });

    expect((await creditService.getWallet(userId)).balance).toBe(5);

    const adjusted = await creditService.adjust({
      userId,
      amount: -5,
      reason: 'Correction to zero',
      adminUserId: admin.id,
    });
    expect(adjusted.amount).toBe(-5);
    expect((await creditService.getWallet(userId)).balance).toBe(0);
  });

  it('refunds credits with a traceable ledger entry', async () => {
    await topUp(10);
    await creditService.refund({
      userId,
      credits: 5,
      description: 'Refund CV Enhancement gagal',
      referenceType: 'cv_enhancement',
      referenceId: 'enh_1',
    });

    const wallet = await creditService.getWallet(userId);
    expect(wallet.balance).toBe(15);

    const transactions = await creditService.listTransactions({ userId, page: 1, pageSize: 10 });
    expect(transactions.items[0]).toMatchObject({ type: 'REFUND', amount: 5, balanceAfter: 15 });
  });

  it('keeps balanceAfter consistent across a sequence of operations', async () => {
    await topUp(20);
    const reservation = await creditService.reserve({ userId, feature: 'HRD_SCREEN_PER_CV', quantity: 4 });
    await creditService.settle({ reservationId: reservation.id, quantity: 4, description: 'Screening 4 CV' });
    await creditService.refund({ userId, credits: 1, description: 'Refund 1 CV gagal' });

    const transactions = await creditService.listTransactions({ userId, page: 1, pageSize: 20 });
    const ordered = [...transactions.items].reverse();
    expect(ordered.map((item) => item.balanceAfter)).toEqual([20, 16, 17]);
    expect(ordered.reduce((sum, item) => sum + item.amount, 0)).toBe(17);
  });

  it('reports an accurate cost estimate and shortfall', async () => {
    await topUp(3);
    const estimate = await creditService.estimate(userId, 'CV_ENHANCEMENT');

    expect(estimate).toMatchObject({
      feature: 'CV_ENHANCEMENT',
      unitCredits: 5,
      totalCredits: 5,
      available: 3,
      sufficient: false,
      shortfall: 2,
    });
  });

  it('uses admin-configured pricing overrides', async () => {
    await topUp(20);
    const admin = await ctx.prisma.user.create({ data: { email: `admin2-${Date.now()}@example.com` } });

    const updated = await pricingService.update('CV_ENHANCEMENT', 8, admin.id);
    expect(updated).toMatchObject({ feature: 'CV_ENHANCEMENT', credits: 8, isOverride: true });

    const estimate = await creditService.estimate(userId, 'CV_ENHANCEMENT');
    expect(estimate.totalCredits).toBe(8);

    const reservation = await creditService.reserve({ userId, feature: 'CV_ENHANCEMENT' });
    expect(reservation.reservedCredits).toBe(8);
  });

  it('surfaces insufficient credits as a typed application error', async () => {
    await expect(creditService.assertAffordable(userId, 'CV_ENHANCEMENT')).rejects.toBeInstanceOf(AppError);
    await expect(creditService.assertAffordable(userId, 'CV_ENHANCEMENT')).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
    });
  });
});
