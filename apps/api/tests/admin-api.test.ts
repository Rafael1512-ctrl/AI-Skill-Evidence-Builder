import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminOverviewResponseSchema } from '@aseb/shared';

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
