import { z } from 'zod';

import { PAYMENT_STATUSES } from '../constants/workflow.js';

/**
 * Top-up request.
 *
 * Exactly one of `packageId` (a curated package) or `credits` (a custom amount priced
 * at the fixed credit value) must be supplied. The service enforces the minimum rupiah
 * value; this schema only rejects obviously malformed input.
 */
export const topUpRequestSchema = z
  .object({
    /** One of TOPUP_PACKAGES[].id. */
    packageId: z.string().trim().min(1).max(64).optional(),
    /** Custom credit amount; the price is `credits x CREDIT_IDR_VALUE`. */
    credits: z.number().int().min(1).max(100_000).optional(),
  })
  .refine((value) => (value.packageId === undefined) !== (value.credits === undefined), {
    message: 'Isi salah satu: packageId atau credits.',
  });

export type TopUpRequest = z.infer<typeof topUpRequestSchema>;

export const paymentTransactionSchema = z.object({
  id: z.string(),
  /** Merchant order id: the reference a user quotes to support. */
  orderId: z.string(),
  provider: z.string(),
  providerTransactionId: z.string().nullable(),
  providerReference: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  amountIdr: z.number().int().min(0),
  credits: z.number().int().min(0),
  /** QRIS payload or a hosted payment URL, when the provider returns one. */
  paymentUrl: z.string().nullable(),
  qrString: z.string().nullable(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  failureReason: z.string().nullable(),
});

export type PaymentTransaction = z.infer<typeof paymentTransactionSchema>;

/**
 * Provider-agnostic inbound webhook envelope.
 *
 * The raw provider payload is verified against the provider's signature scheme, and
 * only then converted into this shape. Credits are granted exclusively from
 * `payment.service.settleFromWebhook`, never because the browser said so.
 *
 * `PENDING` means "the provider acknowledged the attempt but nothing changed" - the
 * event is archived and no state transition is applied.
 */
export const PAYMENT_WEBHOOK_STATUSES = [
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'PENDING',
] as const;

export type PaymentWebhookStatus = (typeof PAYMENT_WEBHOOK_STATUSES)[number];

export const paymentWebhookPayloadSchema = z.object({
  provider: z.string().min(1),
  providerTransactionId: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(PAYMENT_WEBHOOK_STATUSES),
  amountIdr: z.number().int().min(0),
  paidAt: z.string().optional(),
});

export type PaymentWebhookPayload = z.infer<typeof paymentWebhookPayloadSchema>;

/**
 * The offline provider's inbound body.
 *
 * It carries no signature of its own: the mock provider signs the canonical fields
 * with `PAYMENT_MOCK_WEBHOOK_SECRET` and the caller must send that signature in a
 * header, so the verification path is the same shape as a real gateway.
 */
export const mockWebhookBodySchema = z.object({
  providerTransactionId: z.string().min(1),
  orderId: z.string().min(1),
  amountIdr: z.number().int().min(0),
  status: z.enum(PAYMENT_WEBHOOK_STATUSES).default('PAID'),
});

export type MockWebhookBody = z.infer<typeof mockWebhookBodySchema>;

/* -------------------------------------------------------------------------- */
/* Responses consumed by the web client                                        */
/* -------------------------------------------------------------------------- */

/** `POST /api/payments/checkout` */
export const paymentCheckoutResponseSchema = z.object({
  payment: paymentTransactionSchema,
});

export type PaymentCheckoutResponse = z.infer<typeof paymentCheckoutResponseSchema>;

/** `GET /api/payments/:paymentId` and the mock simulation endpoint. */
export const paymentDetailResponseSchema = z.object({
  payment: paymentTransactionSchema,
});

export type PaymentDetailResponse = z.infer<typeof paymentDetailResponseSchema>;

/** `GET /api/payments` */
export const paymentListSchema = z.object({
  items: z.array(paymentTransactionSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type PaymentList = z.infer<typeof paymentListSchema>;

/**
 * The provider-facing webhook acknowledgement.
 *
 * `DUPLICATE` and `IGNORED` are deliberate 200 responses: a gateway must stop retrying
 * once we have durably recorded the delivery, even when no credits moved.
 */
export const paymentWebhookAckSchema = z.object({
  status: z.enum(['PROCESSED', 'DUPLICATE', 'IGNORED']),
  reason: z.string().nullable(),
  payment: paymentTransactionSchema.nullable(),
});

export type PaymentWebhookAck = z.infer<typeof paymentWebhookAckSchema>;
