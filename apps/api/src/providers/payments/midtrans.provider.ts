import { createHash, timingSafeEqual } from 'node:crypto';

import type { PaymentWebhookStatus } from '@aseb/shared';
import { z } from 'zod';

import { AppError } from '../../utils/errors.js';
import type {
  CreatedPayment,
  CreatePaymentInput,
  PaymentProvider,
  VerifiedWebhook,
  WebhookRequest,
} from './types.js';

const SNAP_PATHS = {
  production: 'https://app.midtrans.com/snap/v1/transactions',
  sandbox: 'https://app.sandbox.midtrans.com/snap/v1/transactions',
} as const;

/**
 * Midtrans transaction lifecycle -> our provider-agnostic vocabulary.
 *
 * `capture` only settles when fraud screening says `accept`; a `challenge` stays
 * PENDING because the payment is not confirmed yet. `chargeback` is recorded as a
 * reversal; credits are never reversed automatically (that is an audited admin
 * adjustment, Phase 18).
 */
const TRANSACTION_STATUS_MAP: Readonly<Record<string, PaymentWebhookStatus>> = {
  capture: 'PAID',
  settlement: 'PAID',
  pending: 'PENDING',
  deny: 'FAILED',
  cancel: 'FAILED',
  failure: 'FAILED',
  expire: 'EXPIRED',
  refund: 'REFUNDED',
  partial_refund: 'REFUNDED',
  chargeback: 'REFUNDED',
  partial_chargeback: 'REFUNDED',
};

const snapResponseSchema = z.object({
  token: z.string().min(1),
  redirect_url: z.string().min(1),
});

const notificationSchema = z
  .object({
    transaction_id: z.string().min(1),
    order_id: z.string().min(1),
    status_code: z.string().min(1),
    gross_amount: z.string().min(1),
    signature_key: z.string().min(1),
    transaction_status: z.string().min(1),
    fraud_status: z.string().optional(),
    payment_type: z.string().optional(),
    transaction_time: z.string().optional(),
    settlement_time: z.string().optional(),
  })
  .passthrough();

export type MidtransNotification = z.infer<typeof notificationSchema>;

export interface MidtransProviderOptions {
  serverKey: string | undefined;
  isProduction: boolean;
  clientKey?: string | undefined;
  timeoutMs: number;
  /** Where the gateway sends the user after checkout. */
  finishUrl: string;
}

/**
 * Signature over the notification fields, exactly as Midtrans specifies:
 * `sha512(order_id + status_code + gross_amount + serverKey)`.
 */
export function midtransSignature(
  input: { orderId: string; statusCode: string; grossAmount: string },
  serverKey: string,
): string {
  return createHash('sha512')
    .update(`${input.orderId}${input.statusCode}${input.grossAmount}${serverKey}`)
    .digest('hex');
}

function safeEqualHex(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Maps a Midtrans status pair onto our vocabulary; `null` means "not actionable yet".
 *
 * `capture` is only money in the bank once fraud screening says `accept`; `challenge`
 * means the review is still open, so nothing may be settled.
 */
export function mapMidtransStatus(
  transactionStatus: string,
  fraudStatus: string | undefined,
): PaymentWebhookStatus | null {
  if (transactionStatus === 'capture') {
    if (fraudStatus === 'accept') return 'PAID';
    if (fraudStatus === 'deny') return 'FAILED';
    return null;
  }
  if (transactionStatus === 'settlement' && fraudStatus === 'deny') return 'FAILED';
  return TRANSACTION_STATUS_MAP[transactionStatus] ?? null;
}

/**
 * Midtrans Snap adapter.
 *
 * PREPARED BUT NOT ACTIVE: `PAYMENT_PROVIDER` defaults to `mock`, the adapter only
 * exists when an operator explicitly opts in, and it refuses to do anything without a
 * server key. Activating live payments is always an explicit owner decision.
 */
export class MidtransPaymentProvider implements PaymentProvider {
  readonly name = 'midtrans' as const;

  constructor(private readonly options: MidtransProviderOptions) {}

  private requireServerKey(): string {
    const key = this.options.serverKey;
    if (!key) {
      throw AppError.payment(
        'MIDTRANS_SERVER_KEY belum diatur. Pembayaran Midtrans tidak dapat dijalankan.',
      );
    }
    return key;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const serverKey = this.requireServerKey();
    const expiryMinutes = Math.max(
      1,
      Math.ceil((input.expiresAt.getTime() - Date.now()) / 60_000),
    );

    const body = {
      transaction_details: {
        order_id: input.orderId,
        gross_amount: input.amountIdr,
      },
      item_details: [
        {
          id: input.orderId,
          price: input.amountIdr,
          quantity: 1,
          name: input.itemName.slice(0, 50),
        },
      ],
      customer_details: {
        first_name: (input.customer.fullName ?? 'Pengguna').slice(0, 50),
        email: input.customer.email,
      },
      expiry: { unit: 'minutes', duration: expiryMinutes },
      callbacks: { finish: this.options.finishUrl },
    };

    const url = this.options.isProduction ? SNAP_PATHS.production : SNAP_PATHS.sandbox;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw AppError.upstream('Tidak dapat menghubungi Midtrans.', error);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw AppError.upstream(
        `Midtrans menolak pembuatan transaksi (HTTP ${response.status}).`,
        new Error(detail),
      );
    }

    const parsed = snapResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw AppError.upstream('Respons Midtrans tidak dikenali.', parsed.error);
    }

    return {
      // Midtrans assigns `transaction_id` when the notification arrives, not here.
      providerTransactionId: null,
      providerReference: parsed.data.token,
      paymentUrl: parsed.data.redirect_url,
      qrString: null,
      expiresAt: input.expiresAt,
    };
  }

  verifyWebhook(request: WebhookRequest): VerifiedWebhook {
    const serverKey = this.requireServerKey();
    const parsed = notificationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw AppError.validation(
        { provider: this.name },
        'Payload notifikasi Midtrans tidak dikenali.',
      );
    }
    const body = parsed.data;

    const expected = midtransSignature(
      { orderId: body.order_id, statusCode: body.status_code, grossAmount: body.gross_amount },
      serverKey,
    );
    if (!safeEqualHex(body.signature_key, expected)) {
      throw AppError.forbidden('Tanda tangan notifikasi Midtrans tidak valid.');
    }

    const grossAmount = Number(body.gross_amount);
    if (!Number.isFinite(grossAmount)) {
      throw AppError.validation({ grossAmount: body.gross_amount }, 'Nominal Midtrans tidak valid.');
    }

    const status = mapMidtransStatus(body.transaction_status, body.fraud_status) ?? 'PENDING';
    const paidAt = body.settlement_time ?? body.transaction_time;
    const eventKey = [
      'midtrans',
      body.order_id,
      body.transaction_status,
      body.fraud_status ?? '-',
    ].join(':');

    return {
      eventKey,
      eventType: `midtrans.${body.transaction_status}`,
      payload: {
        provider: this.name,
        providerTransactionId: body.transaction_id,
        orderId: body.order_id,
        status,
        amountIdr: Math.round(grossAmount),
        ...(status === 'PAID' && paidAt ? { paidAt } : {}),
      },
    };
  }
}
