import { createHmac, timingSafeEqual } from 'node:crypto';

import { mockWebhookBodySchema, type MockWebhookBody } from '@aseb/shared';

import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import type {
  CreatedPayment,
  CreatePaymentInput,
  PaymentProvider,
  VerifiedWebhook,
  WebhookRequest,
} from './types.js';

/** Header carrying the HMAC of the canonical webhook fields. */
export const MOCK_WEBHOOK_SIGNATURE_HEADER = 'x-mock-signature';

function headerValue(headers: WebhookRequest['headers'], name: string): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeEqualHex(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Canonical signing string. Only the fields the settlement logic acts on are signed, so
 * an attacker cannot repoint a valid signature at another order, amount or status.
 */
export function mockWebhookSigningString(input: {
  orderId: string;
  providerTransactionId: string;
  amountIdr: number;
  status: string;
}): string {
  return [
    input.orderId,
    input.providerTransactionId,
    String(input.amountIdr),
    input.status,
  ].join('|');
}

export function signMockWebhook(
  input: {
    orderId: string;
    providerTransactionId: string;
    amountIdr: number;
    status: string;
  },
  secret: string = env.PAYMENT_MOCK_WEBHOOK_SECRET,
): string {
  return createHmac('sha256', secret).update(mockWebhookSigningString(input)).digest('hex');
}

/**
 * Offline payment provider.
 *
 * Used by development and by the whole automated test suite, which must never make a
 * real network call. It behaves like a gateway for the parts that matter: it returns a
 * payment attempt and it requires a valid signature before a notification is accepted.
 * No real money can move through it.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  constructor(private readonly secret: string = env.PAYMENT_MOCK_WEBHOOK_SECRET) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return {
      providerTransactionId: `MOCK-${input.orderId}`,
      providerReference: `MOCK-REF-${input.orderId}`,
      // Deliberately no hosted page: there is nowhere to send the user. The status
      // endpoint in the API stands in for the gateway's payment page in development.
      paymentUrl: null,
      qrString: `MOCKQRIS:${input.orderId}`,
      expiresAt: input.expiresAt,
    };
  }

  verifyWebhook(request: WebhookRequest): VerifiedWebhook {
    const body = mockWebhookBodySchema.parse(request.body);

    const provided = headerValue(request.headers, MOCK_WEBHOOK_SIGNATURE_HEADER);
    if (!provided) {
      throw AppError.forbidden('Tanda tangan webhook pembayaran tidak ada.');
    }

    const expected = signMockWebhook(body, this.secret);
    if (!safeEqualHex(provided, expected)) {
      throw AppError.forbidden('Tanda tangan webhook pembayaran tidak valid.');
    }

    return {
      eventKey: `mock:${body.providerTransactionId}:${body.status}`,
      eventType: `mock.${body.status.toLowerCase()}`,
      payload: {
        provider: this.name,
        providerTransactionId: body.providerTransactionId,
        orderId: body.orderId,
        status: body.status,
        amountIdr: body.amountIdr,
        ...(body.status === 'PAID' ? { paidAt: new Date().toISOString() } : {}),
      },
    };
  }
}

export type { MockWebhookBody };
