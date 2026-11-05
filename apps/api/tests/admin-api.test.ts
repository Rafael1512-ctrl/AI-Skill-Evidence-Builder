import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminOverviewResponseSchema, adminReportResponseSchema } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * Admin console API end to end against PGlite.
 *
 * The security expectation first: `/api/admin/*` is unreachable without the admin role, and
 * the role is re-read from the database. Then the two audited mutations - a credit price and a
 * ledger-routed adjustment - which must go through the same services the product uses.
 */

describe('admin API', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let session: DevSession;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ app } = await import('../src/server.test-helper.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    resetRateLimits();
    session = await signUpDevUser(app);
  });

  async function makeAdmin(target: DevSession = session): Promise<DevSession> {
    await ctx.prisma.user.update({ where: { id: target.userId }, data: { role: 'ADMIN' } });
    return { ...target, role: 'ADMIN' };
  }

  it('refuses anonymous and non-admin callers on every admin route', async () => {
    const routes: Array<[string, 'get' | 'post' | 'put' | 'patch']> = [
      ['/api/admin/overview', 'get'],
      ['/api/admin/reports', 'get'],
      ['/api/admin/users', 'get'],
      ['/api/admin/transactions', 'get'],
      ['/api/admin/payments', 'get'],
      ['/api/admin/webhook-events', 'get'],
      ['/api/admin/ai-usage', 'get'],
      ['/api/admin/jobs', 'get'],
      ['/api/admin/failed-candidates', 'get'],
      ['/api/admin/pricing/CV_ENHANCEMENT', 'put'],
      ['/api/admin/users/user_x/role', 'patch'],
      ['/api/admin/users/user_x/credits', 'post'],
    ];

    for (const [path, method] of routes) {
      const anonymous = await request(app)[method](path).send({});
      expect(anonymous.status, `${method} ${path}`).toBe(401);

      const normalUser = await request(app)[method](path).set(bearer(session)).send({});
      expect(normalUser.status, `${method} ${path}`).toBe(403);
    }
  });

  it('returns the dashboard aggregates for an admin', async () => {
    const admin = await makeAdmin();

    const response = await request(app).get('/api/admin/overview').set(bearer(admin));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const parsed = adminOverviewResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.data.overview.users.total).toBe(1);
    expect(response.body.data.overview.users.admins).toBe(1);
    expect(response.body.data.overview.system.queueDriver).toBe('in-process');
    expect(response.body.data.pricing.length).toBeGreaterThan(0);
  });

  it('returns filterable monthly and per-user reports from the real sources', async () => {
    const admin = await makeAdmin();
    const target = await signUpDevUser(app, {
      email: 'report-target@example.com',
      fullName: 'Laporan Target',
    });
    const wallet = await ctx.prisma.creditWallet.findUnique({
      where: { userId: target.userId },
    });
    expect(wallet).not.toBeNull();

    await ctx.prisma.creditTransaction.createMany({
      data: [
        {
          walletId: wallet?.id as string,
          userId: target.userId,
          type: 'TOP_UP',
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
          description: 'Pembelian laporan',
          createdAt: new Date('2026-10-15T03:00:00.000Z'),
        },
        {
          walletId: wallet?.id as string,
          userId: target.userId,
          type: 'USAGE',
          amount: -25,
          balanceBefore: 100,
          balanceAfter: 75,
          feature: 'CV_ENHANCEMENT',
          description: 'Pemakaian laporan',
          createdAt: new Date('2026-10-20T03:00:00.000Z'),
        },
      ],
    });

    await ctx.prisma.aiUsageRecord.createMany({
      data: [
        {
          userId: target.userId,
          feature: 'CV_ENHANCEMENT',
          provider: 'mock',
          model: 'mock-model',
          requestCount: 2,
          inputTokens: 100,
          outputTokens: 50,
          estimatedCostUsd: 0.25,
          creditsCharged: 5,
          createdAt: new Date('2026-10-10T03:00:00.000Z'),
        },
        {
          userId: target.userId,
          feature: 'HRD_SCREEN_PER_CV',
          provider: 'mock',
          model: 'mock-model',
          requestCount: 3,
          inputTokens: 60,
          outputTokens: 20,
          estimatedCostUsd: 0.1,
          creditsCharged: 2,
          success: false,
          createdAt: new Date('2026-11-02T03:00:00.000Z'),
        },
      ],
    });

    await ctx.prisma.paymentTransaction.create({
      data: {
        userId: target.userId,
        provider: 'mock',
        orderId: `report-${Date.now()}`,
        status: 'PAID',
        amountIdr: 50_000,
        credits: 50,
        paidAt: new Date('2026-10-16T03:00:00.000Z'),
        createdAt: new Date('2026-10-10T03:00:00.000Z'),
      },
    });

    const response = await request(app)
      .get('/api/admin/reports?from=2026-10&to=2026-11&sort=purchases')
      .set(bearer(admin));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const parsed = adminReportResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.data.report.range).toEqual({ from: '2026-10', to: '2026-11' });
    expect(response.body.data.report.summary).toMatchObject({
      revenueIdr: 50_000,
      payments: 1,
      creditsPurchased: 100,
      creditsUsed: 25,
      aiRequests: 5,
      aiCreditsCharged: 7,
    });
    expect(response.body.data.report.monthlyRevenue).toEqual([
      { month: '2026-10', revenueIdr: 50_000, payments: 1, creditsSold: 50 },
      { month: '2026-11', revenueIdr: 0, payments: 0, creditsSold: 0 },
    ]);
    expect(response.body.data.report.monthlyAiUsage[1]).toMatchObject({
      month: '2026-11',
      requests: 3,
      failedRequests: 3,
    });
    expect(response.body.data.report.perUser.items[0]).toMatchObject({
      userId: target.userId,
      creditsPurchased: 100,
      purchaseCount: 1,
      creditsUsed: 25,
      usageCount: 1,
    });

    const filtered = await request(app)
      .get(
        `/api/admin/reports?from=2026-10&to=2026-11&feature=CV_ENHANCEMENT&search=${encodeURIComponent(target.email)}`,
      )
      .set(bearer(admin));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.report.summary.aiRequests).toBe(2);
    expect(filtered.body.data.report.monthlyAiUsage[1]?.requests).toBe(0);
    expect(filtered.body.data.report.perUser.total).toBe(1);

    const invalidRange = await request(app)
      .get('/api/admin/reports?from=2026-12&to=2026-11')
      .set(bearer(admin));
    expect(invalidRange.status).toBe(400);
  });

  it('changes a credit price through the pricing service', async () => {
    const admin = await makeAdmin();

    const before = await request(app).get('/api/credits/pricing');
    const beforeEnhancement = before.body.data.find(
      (item: { feature: string }) => item.feature === 'CV_ENHANCEMENT',
    );
    expect(beforeEnhancement.credits).toBe(5);

    const updated = await request(app)
      .put('/api/admin/pricing/CV_ENHANCEMENT')
      .set(bearer(admin))
      .send({ credits: 7 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.pricing).toMatchObject({ credits: 7, isOverride: true });

    // The override is live for the product, not just in the response.
    const after = await request(app).get('/api/credits/pricing');
    const afterEnhancement = after.body.data.find(
      (item: { feature: string }) => item.feature === 'CV_ENHANCEMENT',
    );
    expect(afterEnhancement.credits).toBe(7);

    const row = await ctx.prisma.featurePricing.findUnique({
      where: { feature: 'CV_ENHANCEMENT' },
    });
    expect(row?.updatedByUserId).toBe(admin.userId);

    expect(
      (await request(app).put('/api/admin/pricing/NOPE').set(bearer(admin)).send({ credits: 1 }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put('/api/admin/pricing/CV_ENHANCEMENT')
          .set(bearer(admin))
          .send({ credits: 9_999 })
      ).status,
    ).toBe(400);
  });

  it('adjusts credits through the ledger and refuses a self-demotion', async () => {
    const admin = await makeAdmin();
    const target = await signUpDevUser(app);

    const adjusted = await request(app)
      .post(`/api/admin/users/${target.userId}/credits`)
      .set(bearer(admin))
      .send({ amount: 25, reason: 'kompensasi gangguan layanan' });

    expect(adjusted.status, JSON.stringify(adjusted.body)).toBe(201);
    expect(adjusted.body.data.transaction).toMatchObject({ type: 'ADJUSTMENT', amount: 25 });
    expect(adjusted.body.data.wallet.balance).toBe(25);

    const ledger = await ctx.prisma.creditTransaction.findMany({
      where: { userId: target.userId },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.referenceType).toBe('admin_adjustment');

    expect(
      (
        await request(app)
          .post(`/api/admin/users/${target.userId}/credits`)
          .set(bearer(admin))
          .send({ amount: 0, reason: 'nol tidak boleh' })
      ).status,
    ).toBe(400);

    const promoted = await request(app)
      .patch(`/api/admin/users/${target.userId}/role`)
      .set(bearer(admin))
      .send({ role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.user.role).toBe('ADMIN');

    // An admin cannot lock themselves out of the console.
    expect(
      (
        await request(app)
          .patch(`/api/admin/users/${admin.userId}/role`)
          .set(bearer(admin))
          .send({ role: 'USER' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/api/admin/users/${target.userId}/role`)
          .set(bearer(admin))
          .send({ role: 'DEMIGOD' })
      ).status,
    ).toBe(400);
  });

  it('exposes the reporting lists with their documented keys', async () => {
    const admin = await makeAdmin();

    for (const [path, key] of [
      ['/api/admin/users', 'users'],
      ['/api/admin/transactions', 'transactions'],
      ['/api/admin/payments', 'payments'],
      ['/api/admin/webhook-events', 'events'],
      ['/api/admin/ai-usage', 'usage'],
      ['/api/admin/jobs', 'jobs'],
      ['/api/admin/failed-candidates', 'failed'],
    ] as const) {
      const response = await request(app).get(path).set(bearer(admin));
      expect(response.status, path).toBe(200);
      expect(response.body.data[key], path).toMatchObject({ page: 1, pageSize: 20 });
      expect(Array.isArray(response.body.data[key].items), path).toBe(true);
      expect(response.body.meta.total, path).toBeGreaterThanOrEqual(0);
    }

    // Users carry their wallet balance so support can answer without a second call. The search
    // uses the account's real email: the development sign-up generates a unique address, so a
    // hardcoded name would silently match nothing and the assertion would be about `undefined`.
    const users = await request(app)
      .get(`/api/admin/users?search=${encodeURIComponent(admin.email)}`)
      .set(bearer(admin));
    expect(users.body.data.users.items).toHaveLength(1);
    expect(users.body.data.users.items[0]).toMatchObject({
      email: admin.email,
      balance: 0,
      role: 'ADMIN',
    });

    // The role filter narrows the same list without dropping the wallet join.
    const adminsOnly = await request(app).get('/api/admin/users?role=ADMIN').set(bearer(admin));
    expect(adminsOnly.body.data.users.items.map((item: { email: string }) => item.email)).toEqual([
      admin.email,
    ]);

    // No credential material leaks through the admin list.
    expect(users.body.data.users.items[0]).not.toHaveProperty('passwordHash');
  });
});
