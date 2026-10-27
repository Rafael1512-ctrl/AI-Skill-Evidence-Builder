import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { paymentTransactionSchema, paymentWebhookAckSchema } from '@aseb/shared';

import { env } from '../src/config/env.js';
import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { MOCK_WEBHOOK_SIGNATURE_HEADER, signMockWebhook } from '../src/providers/payments/index.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * End-to-end coverage of the top-up money path.
 *
 * These tests run against real PostgreSQL semantics (PGlite) with the offline provider,
 * so signature verification, amount matching, status transitions, ledger idempotency and
 * "never credit an unverified payment" are all exercised for real.
 */

const PACKAGE_50 = 50;

describe('payments API', () => {
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

    const { pricingService } = await import('../src/services/pricing.service.js');
    pricingService.invalidate();

    session = await signUpDevUser(app);
  });

  function checkout(body: object, target: DevSession = session) {
    return request(app).post('/api/payments/checkout').set(bearer(target)).send(body);
  }

  async function walletOf(target: DevSession) {
    const { creditService } = await import('../src/services/credit.service.js');
    return creditService.getWallet(target.userId);
  }

  function webhook(
    payment: {
      orderId: string;
      providerTransactionId: string | null;
      amountIdr: number;
    },
    overrides: Record<string, unknown> = {},
  ) {
    const body = {
      providerTransactionId: payment.providerTransactionId ?? `MOCK-${payment.orderId}`,
      orderId: payment.orderId,
      amountIdr: payment.amountIdr,
      status: 'PAID' as const,
      ...overrides,
    };
    const signature = signMockWebhook(body, env.PAYMENT_MOCK_WEBHOOK_SECRET);
    return request(app)
      .post('/api/payments/webhook/mock')
      .set(MOCK_WEBHOOK_SIGNATURE_HEADER, signature)
      .send(body);
  }

  async function pendingPayment(
    target: DevSession = session,
    body: object = { packageId: 'credits-50' },
  ) {
    const response = await checkout(body, target);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.payment as {
      id: string;
      orderId: string;
      providerTransactionId: string | null;
      amountIdr: number;
      credits: number;
      status: string;
    };
  }

  it('requires authentication to start a top-up', async () => {
    const response = await request(app)
      .post('/api/payments/checkout')
      .send({ packageId: 'credits-50' });

    expect(response.status).toBe(401);
    expect(await ctx.prisma.paymentTransaction.count()).toBe(0);
  });

  it('rejects a top-up that names both a package and a credit amount', async () => {
    const response = await checkout({ packageId: 'credits-50', credits: 50 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a top-up that names neither', async () => {
    const response = await checkout({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown package', async () => {
    const response = await checkout({ packageId: 'credits-9999' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await ctx.prisma.paymentTransaction.count()).toBe(0);
  });

  it('rejects a custom amount below the minimum top-up', async () => {
    // 10 credits x Rp1.000 = Rp10.000, below the Rp50.000 floor.
    const response = await checkout({ credits: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await ctx.prisma.paymentTransaction.count()).toBe(0);
  });

  it('creates a PENDING attempt without granting any credits', async () => {
    const payment = await pendingPayment();

    expect(payment.status).toBe('PENDING');
    expect(payment.credits).toBe(PACKAGE_50);
    expect(payment.amountIdr).toBe(50_000);
    expect(payment.providerTransactionId).toBe(`MOCK-${payment.orderId}`);

    const parsed = paymentTransactionSchema.safeParse(payment);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const wallet = await walletOf(session);
    expect(wallet.balance).toBe(0);
    expect(await ctx.prisma.creditTransaction.count({ where: { type: 'TOP_UP' } })).toBe(0);
  });

  it('accepts a custom credit amount at or above the minimum', async () => {
    const payment = await pendingPayment(session, { credits: 75 });

    expect(payment.credits).toBe(75);
    expect(payment.amountIdr).toBe(75_000);
  });

  it('refuses a webhook with an invalid signature and credits nothing', async () => {
    const payment = await pendingPayment();

    const response = await request(app)
      .post('/api/payments/webhook/mock')
      .set(MOCK_WEBHOOK_SIGNATURE_HEADER, 'not-a-valid-signature')
      .send({
        providerTransactionId: payment.providerTransactionId,
        orderId: payment.orderId,
        amountIdr: payment.amountIdr,
        status: 'PAID',
      });

    expect(response.status).toBe(403);
    expect(await ctx.prisma.paymentWebhookEvent.count()).toBe(0);
    expect((await walletOf(session)).balance).toBe(0);
  });

  it('settles a verified payment exactly once and writes a TOP_UP ledger row', async () => {
    const payment = await pendingPayment();

    const response = await webhook(payment);

    expect(response.status).toBe(200);
    const ack = paymentWebhookAckSchema.safeParse(response.body.data);
    expect(ack.success, JSON.stringify(ack.error?.issues)).toBe(true);
    expect(response.body.data.status).toBe('PROCESSED');
    expect(response.body.data.payment.status).toBe('COMPLETED');
    expect(response.body.data.payment.paidAt).toBeTruthy();
    expect(response.body.data.payment.completedAt).toBeTruthy();

    const wallet = await walletOf(session);
    expect(wallet.balance).toBe(PACKAGE_50);
    expect(wallet.lifetimeCreditsIn).toBe(PACKAGE_50);

    const ledger = await ctx.prisma.creditTransaction.findMany({ where: { type: 'TOP_UP' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      userId: session.userId,
      amount: PACKAGE_50,
      balanceAfter: PACKAGE_50,
      referenceType: 'payment',
      referenceId: payment.id,
      idempotencyKey: `payment:${payment.id}`,
    });

    const event = await ctx.prisma.paymentWebhookEvent.findFirst();
    expect(event?.processed).toBe(true);
    expect(event?.signatureValid).toBe(true);
    expect(event?.paymentTransactionId).toBe(payment.id);
  });

  it('treats a repeated delivery as a no-op', async () => {
    const payment = await pendingPayment();
    expect((await webhook(payment)).status).toBe(200);

    const replay = await webhook(payment);

    expect(replay.status).toBe(200);
    expect(replay.body.data.status).toBe('DUPLICATE');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);
    expect(await ctx.prisma.creditTransaction.count({ where: { type: 'TOP_UP' } })).toBe(1);
    expect(await ctx.prisma.paymentWebhookEvent.count()).toBe(1);
  });

  it('never credits a payment whose notified amount does not match', async () => {
    const payment = await pendingPayment();

    const response = await webhook(payment, { amountIdr: 1_000_000 });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('IGNORED');
    expect(response.body.data.reason).toBe('AMOUNT_MISMATCH');
    expect(response.body.data.payment.status).toBe('PENDING');
    expect((await walletOf(session)).balance).toBe(0);
  });

  it('acknowledges an unknown order without crediting anything', async () => {
    const response = await request(app)
      .post('/api/payments/webhook/mock')
      .set(
        MOCK_WEBHOOK_SIGNATURE_HEADER,
        signMockWebhook(
          {
            providerTransactionId: 'MOCK-TOPUP-UNKNOWN',
            orderId: 'TOPUP-UNKNOWN',
            amountIdr: 50_000,
            status: 'PAID',
          },
          env.PAYMENT_MOCK_WEBHOOK_SECRET,
        ),
      )
      .send({
        providerTransactionId: 'MOCK-TOPUP-UNKNOWN',
        orderId: 'TOPUP-UNKNOWN',
        amountIdr: 50_000,
        status: 'PAID',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'IGNORED', reason: 'ORDER_NOT_FOUND' });
    expect(await ctx.prisma.paymentWebhookEvent.count()).toBe(1);
  });

  it('records a PENDING notification without changing anything', async () => {
    const payment = await pendingPayment();

    const response = await webhook(payment, { status: 'PENDING' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'IGNORED', reason: 'NO_STATE_CHANGE' });
    expect(response.body.data.payment.status).toBe('PENDING');
    expect((await walletOf(session)).balance).toBe(0);
  });

  it('marks an expired notification EXPIRED and credits nothing', async () => {
    const payment = await pendingPayment();

    const response = await webhook(payment, { status: 'EXPIRED' });

    expect(response.status).toBe(200);
    expect(response.body.data.payment.status).toBe('EXPIRED');
    expect(response.body.data.payment.failureReason).toContain('Batas waktu');
    expect((await walletOf(session)).balance).toBe(0);
  });

  it('never downgrades a completed payment when a late failure notification arrives', async () => {
    const payment = await pendingPayment();
    await webhook(payment);

    const late = await webhook(payment, { status: 'FAILED' });

    expect(late.status).toBe(200);
    expect(late.body.data.status).toBe('IGNORED');
    expect(late.body.data.reason).toBe('ALREADY_SETTLED');
    expect(late.body.data.payment.status).toBe('COMPLETED');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);
  });

  it('records a refund on a completed payment without silently removing credits', async () => {
    const payment = await pendingPayment();
    await webhook(payment);

    const refund = await webhook(payment, { status: 'REFUNDED' });

    expect(refund.status).toBe(200);
    expect(refund.body.data.payment.status).toBe('REFUNDED');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);
  });

  it('ignores a refund for a payment that was never settled', async () => {
    const payment = await pendingPayment();

    const refund = await webhook(payment, { status: 'REFUNDED' });

    expect(refund.body.data).toMatchObject({ status: 'IGNORED', reason: 'NOT_SETTLED' });
    expect(refund.body.data.payment.status).toBe('PENDING');
  });

  it('marks overdue attempts EXPIRED without crediting them', async () => {
    const payment = await pendingPayment();
    const { paymentService } = await import('../src/services/payment.service.js');

    const changed = await paymentService.expireOverdue(new Date(Date.now() + 25 * 60 * 60 * 1_000));

    expect(changed).toBe(1);
    const row = await ctx.prisma.paymentTransaction.findUnique({ where: { id: payment.id } });
    expect(row?.status).toBe('EXPIRED');
    expect((await walletOf(session)).balance).toBe(0);
  });

  it('still settles a signed payment that arrived after local expiry', async () => {
    const payment = await pendingPayment();
    const { paymentService } = await import('../src/services/payment.service.js');
    await paymentService.expireOverdue(new Date(Date.now() + 25 * 60 * 60 * 1_000));

    const response = await webhook(payment);

    expect(response.body.data.status).toBe('PROCESSED');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);
  });

  it('retries a delivery that was recorded but never processed', async () => {
    const payment = await pendingPayment();

    // Simulates a crash after archiving the notification but before settlement.
    await ctx.prisma.paymentWebhookEvent.create({
      data: {
        provider: 'mock',
        eventKey: `mock:${payment.providerTransactionId}:PAID`,
        eventType: 'mock.paid',
        payload: { simulated: 'crash after recording' },
        signatureValid: true,
        processed: false,
      },
    });

    const response = await webhook(payment);

    expect(response.body.data.status).toBe('PROCESSED');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);
    expect(await ctx.prisma.paymentWebhookEvent.count()).toBe(1);
    const event = await ctx.prisma.paymentWebhookEvent.findFirst();
    expect(event?.processed).toBe(true);
  });

  it('completes a payment that was claimed but never granted', async () => {
    const payment = await pendingPayment();
    // Simulates a crash between the PAID transition and the ledger grant.
    await ctx.prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const response = await webhook(payment);

    expect(response.body.data.status).toBe('PROCESSED');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);
    expect(await ctx.prisma.creditTransaction.count({ where: { type: 'TOP_UP' } })).toBe(1);
  });

  it('settles through the development simulation endpoint on the webhook path', async () => {
    const payment = await pendingPayment();

    const response = await request(app)
      .post(`/api/payments/${payment.id}/simulate`)
      .set(bearer(session))
      .send({});

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.payment.status).toBe('COMPLETED');
    expect((await walletOf(session)).balance).toBe(PACKAGE_50);

    const event = await ctx.prisma.paymentWebhookEvent.findFirst();
    expect(event?.signatureValid).toBe(true);
    expect(event?.processed).toBe(true);
  });

  it('refuses to simulate another user’s payment', async () => {
    const payment = await pendingPayment();
    const stranger = await signUpDevUser(app);

    const response = await request(app)
      .post(`/api/payments/${payment.id}/simulate`)
      .set(bearer(stranger))
      .send({});

    expect(response.status).toBe(404);
    expect((await walletOf(stranger)).balance).toBe(0);
    expect((await walletOf(session)).balance).toBe(0);
  });

  it('hides another user’s payment behind a 404', async () => {
    const payment = await pendingPayment();
    const stranger = await signUpDevUser(app);

    const response = await request(app).get(`/api/payments/${payment.id}`).set(bearer(stranger));

    expect(response.status).toBe(404);
  });

  it('lists only the caller’s own attempts', async () => {
    await pendingPayment();
    await pendingPayment();
    const stranger = await signUpDevUser(app);
    await pendingPayment(stranger);

    const response = await request(app)
      .get('/api/payments?page=1&pageSize=10')
      .set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.items).toHaveLength(2);
    expect(
      (response.body.data.items as Array<{ orderId: string }>).every((item) =>
        item.orderId.startsWith('TOPUP-'),
      ),
    ).toBe(true);
  });

  it('does not expose the Midtrans callback while the mock provider is active', async () => {
    const response = await request(app).post('/api/payments/webhook/midtrans').send({});

    expect(response.status).toBe(404);
    expect(await ctx.prisma.paymentWebhookEvent.count()).toBe(0);
  });
});
