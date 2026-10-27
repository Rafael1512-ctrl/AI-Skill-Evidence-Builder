import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TOPUP_PACKAGES } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import type { CreditService } from '../src/services/credit.service.js';
import type { PricingService } from '../src/services/pricing.service.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * HTTP-level coverage for the credit endpoints the web client consumes.
 *
 * The ledger itself is covered by `credit-ledger.test.ts`; these assertions pin the
 * *wire format* (envelope, field names, pagination, error codes) so the frontend Zod
 * schemas cannot silently drift from the API.
 */
describe('credits API', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let creditService: CreditService;
  let pricingService: PricingService;
  let session: DevSession;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ app } = await import('../src/server.test-helper.js'));
    ({ creditService } = await import('../src/services/credit.service.js'));
    ({ pricingService } = await import('../src/services/pricing.service.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    resetRateLimits();
    pricingService.invalidate();
    session = await signUpDevUser(app);
  });

  it('publishes the price list without a session', async () => {
    const response = await request(app).get('/api/credits/pricing');

    expect(response.status).toBe(200);
    const items = response.body.data as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);

    const audit = items.find((item) => item.feature === 'FREE_CV_AUDIT');
    expect(audit).toMatchObject({ credits: 0, isOverride: false });

    const enhancement = items.find((item) => item.feature === 'CV_ENHANCEMENT');
    expect(enhancement).toMatchObject({ credits: 5 });

    const sortOrders = items.map((item) => item.sortOrder as number);
    expect([...sortOrders].sort((left, right) => left - right)).toEqual(sortOrders);
  });

  it('publishes top-up packages without a session', async () => {
    const response = await request(app).get('/api/credits/packages');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(TOPUP_PACKAGES);
  });

  it('reflects an admin pricing override in the public list', async () => {
    await pricingService.update('CV_ENHANCEMENT', 7, session.userId);

    const response = await request(app).get('/api/credits/pricing');
    const enhancement = (response.body.data as Array<Record<string, unknown>>).find(
      (item) => item.feature === 'CV_ENHANCEMENT',
    );

    expect(enhancement).toMatchObject({ credits: 7, isOverride: true });
  });

  it('requires a session for the wallet', async () => {
    const response = await request(app).get('/api/credits/wallet');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns the wallet in the shape the web client validates', async () => {
    const response = await request(app).get('/api/credits/wallet').set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      userId: session.userId,
      balance: 0,
      reserved: 0,
      available: 0,
      lifetimeCreditsIn: 0,
      lifetimeCreditsSpent: 0,
    });
    expect(Object.keys(response.body.data).sort()).toEqual(
      [
        'available',
        'balance',
        'id',
        'lifetimeCreditsIn',
        'lifetimeCreditsSpent',
        'reserved',
        'updatedAt',
        'userId',
      ].sort(),
    );
  });

  it('returns an empty first page of transactions', async () => {
    const response = await request(app).get('/api/credits/transactions').set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(response.body.meta).toEqual({ page: 1, pageSize: 20, total: 0 });
  });

  it('honours pagination parameters', async () => {
    const response = await request(app)
      .get('/api/credits/transactions?page=2&pageSize=5')
      .set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 2, pageSize: 5 });
  });

  it('rejects pagination outside the allowed bounds', async () => {
    const response = await request(app)
      .get('/api/credits/transactions?pageSize=500')
      .set(bearer(session));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists a top-up as a ledger entry', async () => {
    await creditService.grantTopUp({
      userId: session.userId,
      credits: 50,
      amountIdr: 50_000,
      paymentTransactionId: 'pay-api-test',
    });

    const response = await request(app).get('/api/credits/transactions').set(bearer(session));

    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0]).toMatchObject({
      type: 'TOP_UP',
      amount: 50,
      balanceAfter: 50,
    });

    const wallet = await request(app).get('/api/credits/wallet').set(bearer(session));
    expect(wallet.body.data).toMatchObject({ balance: 50, reserved: 0, available: 50 });
  });

  it('estimates the cost of a paid feature against the wallet', async () => {
    const response = await request(app)
      .post('/api/credits/estimate')
      .set(bearer(session))
      .send({ feature: 'CV_ENHANCEMENT' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      feature: 'CV_ENHANCEMENT',
      quantity: 1,
      unitCredits: 5,
      totalCredits: 5,
      available: 0,
      sufficient: false,
      shortfall: 5,
    });
  });

  it('estimates a free feature as sufficient', async () => {
    const response = await request(app)
      .post('/api/credits/estimate')
      .set(bearer(session))
      .send({ feature: 'FREE_CV_AUDIT', quantity: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ unitCredits: 0, totalCredits: 0, sufficient: true });
  });

  it('rejects an unknown feature key', async () => {
    const response = await request(app)
      .post('/api/credits/estimate')
      .set(bearer(session))
      .send({ feature: 'NOT_A_FEATURE' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a session to estimate', async () => {
    const response = await request(app)
      .post('/api/credits/estimate')
      .send({ feature: 'CV_ENHANCEMENT' });

    expect(response.status).toBe(401);
  });
});
