import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { AppError } from '../src/utils/errors.js';
import {
  MOCK_WEBHOOK_SIGNATURE_HEADER,
  MockPaymentProvider,
  mapMidtransStatus,
  midtransSignature,
  MockPaymentProvider as MockProviderAlias,
  signMockWebhook,
} from '../src/providers/payments/index.js';
import { MidtransPaymentProvider } from '../src/providers/payments/midtrans.provider.js';

/**
 * Provider-boundary tests. They are fully offline: no database, no sockets, no network.
 * What they pin is the part that protects money - signature verification and the
 * provider-status vocabulary.
 */

const MOCK_SECRET = 'unit-test-mock-secret';

function buildMockProvider(): MockPaymentProvider {
  return new MockPaymentProvider(MOCK_SECRET);
}

describe('mock payment provider', () => {
  it('exposes a deterministic payment attempt with no hosted URL', async () => {
    const provider = buildMockProvider();
    const expiresAt = new Date('2026-10-01T00:00:00.000Z');

    const created = await provider.createPayment({
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      credits: 50,
      itemName: 'Top-up 50 Kredit',
      customer: { userId: 'user-1', email: 'user@example.com', fullName: 'Siti' },
      expiresAt,
    });

    expect(created.providerTransactionId).toBe('MOCK-TOPUP-TEST-1');
    expect(created.paymentUrl).toBeNull();
    expect(created.qrString).toBe('MOCKQRIS:TOPUP-TEST-1');
    expect(created.expiresAt).toEqual(expiresAt);
  });

  it('accepts a correctly signed notification', () => {
    const provider = buildMockProvider();
    const body = {
      providerTransactionId: 'MOCK-TOPUP-TEST-1',
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      status: 'PAID' as const,
    };

    const verified = provider.verifyWebhook({
      headers: { [MOCK_WEBHOOK_SIGNATURE_HEADER]: signMockWebhook(body, MOCK_SECRET) },
      body,
    });

    expect(verified.payload).toMatchObject({
      provider: 'mock',
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      status: 'PAID',
    });
    expect(verified.eventKey).toBe('mock:MOCK-TOPUP-TEST-1:PAID');
    expect(verified.payload.paidAt).toBeTruthy();
  });

  it('rejects a notification without a signature', () => {
    const provider = buildMockProvider();

    expect(() => provider.verifyWebhook({ headers: {}, body: {} })).toThrow();
  });

  it('rejects a missing signature header on an otherwise valid body', () => {
    const provider = buildMockProvider();
    const body = {
      providerTransactionId: 'MOCK-TOPUP-TEST-1',
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      status: 'PAID' as const,
    };

    expect(() => provider.verifyWebhook({ headers: {}, body })).toThrowError(AppError);
  });

  it('rejects a tampered amount even though the signature looks well formed', () => {
    const provider = buildMockProvider();
    const original = {
      providerTransactionId: 'MOCK-TOPUP-TEST-1',
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      status: 'PAID' as const,
    };
    const signature = signMockWebhook(original, MOCK_SECRET);

    expect(() =>
      provider.verifyWebhook({
        headers: { [MOCK_WEBHOOK_SIGNATURE_HEADER]: signature },
        body: { ...original, amountIdr: 1_000_000 },
      }),
    ).toThrowError(AppError);
  });

  it('rejects a signature signed with a different secret', () => {
    const provider = buildMockProvider();
    const body = {
      providerTransactionId: 'MOCK-TOPUP-TEST-1',
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      status: 'PAID' as const,
    };

    expect(() =>
      provider.verifyWebhook({
        headers: { [MOCK_WEBHOOK_SIGNATURE_HEADER]: signMockWebhook(body, 'not-the-secret') },
        body,
      }),
    ).toThrowError(AppError);
  });

  it('rejects an unknown status at the boundary', () => {
    const provider = buildMockProvider();
    const body = {
      providerTransactionId: 'MOCK-TOPUP-TEST-1',
      orderId: 'TOPUP-TEST-1',
      amountIdr: 50_000,
      status: 'SETTLED',
    };

    expect(() =>
      provider.verifyWebhook({
        headers: { [MOCK_WEBHOOK_SIGNATURE_HEADER]: 'irrelevant' },
        body,
      }),
    ).toThrowError(ZodError);
  });

  it('keeps the alias export wired to the same class', () => {
    expect(new MockProviderAlias(MOCK_SECRET)).toBeInstanceOf(MockPaymentProvider);
  });
});

describe('midtrans provider', () => {
  const provider = new MidtransPaymentProvider({
    serverKey: 'test-server-key',
    isProduction: false,
    timeoutMs: 1_000,
    finishUrl: 'http://localhost:5173/credits',
  });

  function notification(overrides: Record<string, unknown> = {}) {
    const base = {
      transaction_id: 'tx-1',
      order_id: 'TOPUP-TEST-1',
      status_code: '200',
      gross_amount: '50000.00',
      transaction_status: 'settlement',
      fraud_status: 'accept',
      transaction_time: '2026-09-26T10:00:00.000Z',
      settlement_time: '2026-09-26T10:00:05.000Z',
      ...overrides,
    };
    const signature = createHash('sha512')
      .update(
        [
          String(base.order_id),
          String(base.status_code),
          String(base.gross_amount),
          'test-server-key',
        ].join(''),
      )
      .digest('hex');
    return { ...base, signature_key: signature };
  }

  it('computes the documented sha512 signature over order/status/amount/server key', () => {
    const expected = createHash('sha512').update('order-120050000.00test-key').digest('hex');

    expect(
      midtransSignature(
        { orderId: 'order-1', statusCode: '200', grossAmount: '50000.00' },
        'test-key',
      ),
    ).toBe(expected);
  });

  it('accepts a settled notification and normalises it', () => {
    const verified = provider.verifyWebhook({ headers: {}, body: notification() });

    expect(verified.payload).toMatchObject({
      provider: 'midtrans',
      providerTransactionId: 'tx-1',
      orderId: 'TOPUP-TEST-1',
      status: 'PAID',
      amountIdr: 50_000,
    });
    expect(verified.payload.paidAt).toBe('2026-09-26T10:00:05.000Z');
  });

  it('refuses a forged notification', () => {
    expect(() =>
      provider.verifyWebhook({
        headers: {},
        body: { ...notification(), signature_key: 'deadbeef' },
      }),
    ).toThrowError(AppError);
  });

  it('refuses a notification whose amount was changed after signing', () => {
    expect(() =>
      provider.verifyWebhook({
        headers: {},
        body: { ...notification(), gross_amount: '1000000.00' },
      }),
    ).toThrowError(AppError);
  });

  it('refuses to verify anything without a server key', () => {
    const unconfigured = new MidtransPaymentProvider({
      serverKey: undefined,
      isProduction: false,
      timeoutMs: 1_000,
      finishUrl: 'http://localhost:5173/credits',
    });

    expect(() => unconfigured.verifyWebhook({ headers: {}, body: notification() })).toThrowError(
      AppError,
    );
  });

  it.each([
    ['settlement', 'accept', 'PAID'],
    ['capture', 'accept', 'PAID'],
    // Fraud review still open: not actionable, so nothing may be settled.
    ['capture', 'challenge', null],
    ['capture', 'deny', 'FAILED'],
    ['settlement', 'deny', 'FAILED'],
    ['pending', undefined, 'PENDING'],
    ['deny', undefined, 'FAILED'],
    ['cancel', undefined, 'FAILED'],
    ['expire', undefined, 'EXPIRED'],
    ['refund', undefined, 'REFUNDED'],
    ['chargeback', undefined, 'REFUNDED'],
  ])('maps %s/%s to %s', (transactionStatus, fraudStatus, expected) => {
    expect(mapMidtransStatus(transactionStatus, fraudStatus)).toBe(expected);
  });

  it('returns null for a status it does not act on', () => {
    expect(mapMidtransStatus('unknown_status', undefined)).toBeNull();
  });
});
