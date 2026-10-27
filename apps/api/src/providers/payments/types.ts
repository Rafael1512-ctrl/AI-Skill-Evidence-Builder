import type { PaymentWebhookPayload } from '@aseb/shared';

/**
 * The payment gateway boundary.
 *
 * Providers own transport only: they create a hosted payment attempt and they verify
 * an inbound notification's authenticity. They never touch credits or the database -
 * `PaymentService` decides what a verified notification means, and the credit ledger
 * is the only place a balance changes.
 */

export interface PaymentCustomer {
  userId: string;
  email: string;
  fullName: string | null;
}

export interface CreatePaymentInput {
  /** Merchant-generated, unique per attempt. */
  orderId: string;
  amountIdr: number;
  credits: number;
  itemName: string;
  customer: PaymentCustomer;
  expiresAt: Date;
}

export interface CreatedPayment {
  providerTransactionId: string | null;
  providerReference: string | null;
  /** Hosted checkout URL the user can open, when the provider returns one. */
  paymentUrl: string | null;
  /** QRIS payload, when the provider returns one. */
  qrString: string | null;
  expiresAt: Date;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface VerifiedWebhook {
  /** Deterministic per (payment, status): a repeated delivery collides and is a no-op. */
  eventKey: string;
  eventType: string;
  payload: PaymentWebhookPayload;
}

export type PaymentProviderName = 'mock' | 'midtrans';

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /**
   * Verifies the signature and normalises the payload.
   *
   * Must throw `AppError.forbidden` when the signature is missing or wrong, and must
   * never return an unverified payload.
   */
  verifyWebhook(request: WebhookRequest): VerifiedWebhook;
}
