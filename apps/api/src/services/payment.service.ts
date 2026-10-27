import { randomBytes } from 'node:crypto';

import {
  CREDIT_ECONOMY,
  findTopUpPackage,
  topUpAmountIdr,
  topUpCreditsForIdr,
  type PaymentTransaction as PaymentTransactionDto,
} from '@aseb/shared';

import { env } from '../config/env.js';
import type { PaymentTransaction } from '../generated/prisma/client.js';
import {
  getPaymentProvider,
  signMockWebhook,
  MOCK_WEBHOOK_SIGNATURE_HEADER,
  type PaymentProvider,
  type PaymentProviderName,
  type VerifiedWebhook,
  type WebhookRequest,
} from '../providers/payments/index.js';
import { PaymentRepository } from '../repositories/payment.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/errors.js';
import { toIso } from '../utils/values.js';
import { creditService, type CreditService } from './credit.service.js';

export type WebhookOutcome = 'PROCESSED' | 'DUPLICATE' | 'IGNORED';

export interface WebhookResult {
  status: WebhookOutcome;
  /** Machine-readable explanation for IGNORED/DUPLICATE outcomes. */
  reason: string | null;
  payment: PaymentTransactionDto | null;
}

export interface CheckoutInput {
  userId: string;
  packageId?: string | undefined;
  credits?: number | undefined;
}

/** Human-readable, collision-resistant merchant order id. */
function buildOrderId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = randomBytes(4).toString('hex').toUpperCase();
  return `TOPUP-${stamp}-${suffix}`;
}

export function toPaymentTransactionDto(row: PaymentTransaction): PaymentTransactionDto {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: row.provider,
    providerTransactionId: row.providerTransactionId,
    providerReference: row.providerReference,
    status: row.status,
    amountIdr: row.amountIdr,
    credits: row.credits,
    paymentUrl: row.paymentUrl,
    qrString: row.qrString,
    expiresAt: toIso(row.expiresAt),
    paidAt: toIso(row.paidAt),
    completedAt: toIso(row.completedAt),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    failureReason: row.failureReason,
  };
}

function failureReasonFor(status: 'FAILED' | 'EXPIRED'): string {
  return status === 'FAILED'
    ? 'Pembayaran ditolak atau dibatalkan oleh penyedia.'
    : 'Batas waktu pembayaran terlewat.';
}

/**
 * Top-up orchestration.
 *
 * Responsibilities, in order: resolve the amount from shared configuration, create a
 * PENDING attempt, ask the provider for a payment instrument, and - on a *verified*
 * notification only - credit the wallet through the ledger. The browser never decides
 * that a payment succeeded: only `handleWebhook` settles, and it settles exactly once.
 */
export class PaymentService {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly users = new UserRepository(),
    private readonly credits: CreditService = creditService,
  ) {}

  private resolveTopUp(input: CheckoutInput): {
    credits: number;
    amountIdr: number;
    itemName: string;
  } {
    const minimumIdr = CREDIT_ECONOMY.MIN_TOPUP_IDR;

    if (input.packageId !== undefined) {
      const pkg = findTopUpPackage(input.packageId);
      if (!pkg) {
        throw AppError.validation({ packageId: input.packageId }, 'Paket top-up tidak dikenal.');
      }
      return { credits: pkg.credits, amountIdr: pkg.priceIdr, itemName: `Top-up ${pkg.label}` };
    }

    if (input.credits === undefined) {
      throw AppError.validation(undefined, 'Pilih paket top-up atau isi jumlah kredit.');
    }

    const amountIdr = topUpAmountIdr(input.credits);
    if (amountIdr < minimumIdr) {
      throw AppError.validation(
        { credits: input.credits, amountIdr, minimumIdr },
        `Minimum top-up adalah ${minimumIdr} rupiah (${topUpCreditsForIdr(minimumIdr)} kredit).`,
      );
    }

    return { credits: input.credits, amountIdr, itemName: `Top-up ${input.credits} Kredit` };
  }

  /** Creates a PENDING top-up attempt and asks the provider for a payment instrument. */
  async checkout(input: CheckoutInput): Promise<PaymentTransactionDto> {
    const user = await this.users.findById(input.userId);
    if (!user) {
      throw AppError.notFound('Pengguna tidak ditemukan.');
    }

    const topUp = this.resolveTopUp(input);
    const provider = getPaymentProvider();
    const orderId = buildOrderId();
    const expiresAt = new Date(Date.now() + env.PAYMENT_EXPIRY_MINUTES * 60_000);

    const transaction = await this.repository.create({
      userId: user.id,
      provider: provider.name,
      orderId,
      credits: topUp.credits,
      amountIdr: topUp.amountIdr,
      expiresAt,
    });

    try {
      const created = await provider.createPayment({
        orderId,
        amountIdr: topUp.amountIdr,
        credits: topUp.credits,
        itemName: topUp.itemName,
        customer: { userId: user.id, email: user.email, fullName: user.fullName },
        expiresAt,
      });
      const updated = await this.repository.applyProviderResult(transaction.id, {
        providerTransactionId: created.providerTransactionId,
        providerReference: created.providerReference,
        paymentUrl: created.paymentUrl,
        qrString: created.qrString,
        expiresAt: created.expiresAt,
      });
      return toPaymentTransactionDto(updated ?? transaction);
    } catch (error) {
      // The attempt is recorded as FAILED so the user sees why it never opened, but no
      // credits exist yet and nothing is owed.
      await this.repository
        .markStatus(transaction.id, 'FAILED', 'Gagal membuat transaksi ke penyedia pembayaran.')
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Verifies, archives and applies one provider notification.
   *
   * Every delivery is persisted before it is processed (unique `event_key`), so a
   * redelivery is a no-op and a crash mid-processing leaves an inspectable row.
   */
  async handleWebhook(
    providerName: PaymentProviderName,
    request: WebhookRequest,
  ): Promise<WebhookResult> {
    const provider = getPaymentProvider();
    if (provider.name !== providerName) {
      throw AppError.notFound('Webhook pembayaran tidak tersedia.');
    }

    // Throws FORBIDDEN when the signature is missing or wrong: nothing is recorded and
    // nothing is credited for an unauthenticated call.
    const verified = provider.verifyWebhook(request);

    const { event, created } = await this.repository.upsertWebhookEvent({
      provider: provider.name,
      eventKey: verified.eventKey,
      eventType: verified.eventType,
      payload: request.body,
      signatureValid: true,
    });

    // A delivery that already completed is a genuine redelivery: acknowledge and stop.
    // A delivery recorded but not completed failed mid-processing, so it is retried -
    // every settlement step (claim, ledger grant, complete) is idempotent.
    if (!created && event.processed) {
      return { status: 'DUPLICATE', reason: 'DELIVERY_ALREADY_PROCESSED', payment: null };
    }

    try {
      const result = await this.applyVerifiedWebhook(provider, verified);
      await this.repository.markWebhookEvent(event.id, {
        processed: true,
        paymentTransactionId: result.payment?.id ?? null,
      });
      return result;
    } catch (error) {
      await this.repository
        .markWebhookEvent(event.id, {
          processed: false,
          errorMessage: error instanceof Error ? error.message : 'unknown error',
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private async applyVerifiedWebhook(
    provider: PaymentProvider,
    verified: VerifiedWebhook,
  ): Promise<WebhookResult> {
    const payload = verified.payload;
    const payment = await this.repository.findByOrderId(payload.orderId);

    // Unknown order: acknowledge so the gateway stops retrying, credit nothing.
    if (!payment) {
      return { status: 'IGNORED', reason: 'ORDER_NOT_FOUND', payment: null };
    }
    if (payment.provider !== provider.name) {
      return {
        status: 'IGNORED',
        reason: 'PROVIDER_MISMATCH',
        payment: toPaymentTransactionDto(payment),
      };
    }
    // Amount is part of the settlement decision, not just the signature.
    if (payment.amountIdr !== payload.amountIdr) {
      return {
        status: 'IGNORED',
        reason: 'AMOUNT_MISMATCH',
        payment: toPaymentTransactionDto(payment),
      };
    }

    switch (payload.status) {
      case 'PENDING':
        return {
          status: 'IGNORED',
          reason: 'NO_STATE_CHANGE',
          payment: toPaymentTransactionDto(payment),
        };

      case 'PAID': {
        if (payment.status === 'COMPLETED') {
          return {
            status: 'DUPLICATE',
            reason: 'ALREADY_SETTLED',
            payment: toPaymentTransactionDto(payment),
          };
        }
        if (payment.status === 'FAILED' || payment.status === 'REFUNDED') {
          return {
            status: 'IGNORED',
            reason: `PAYMENT_${payment.status}`,
            payment: toPaymentTransactionDto(payment),
          };
        }

        const claimed = await this.repository.claimPaid(payment.id, {
          paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
          providerTransactionId: payload.providerTransactionId,
          providerReference: payment.providerReference,
        });
        if (!claimed) {
          return {
            status: 'DUPLICATE',
            reason: 'ALREADY_CLAIMED',
            payment: toPaymentTransactionDto(payment),
          };
        }

        // The ledger grant is idempotent on `payment:<id>`; a retry cannot double-credit.
        await this.credits.grantTopUp({
          userId: payment.userId,
          credits: payment.credits,
          amountIdr: payment.amountIdr,
          paymentTransactionId: payment.id,
        });

        const completed = await this.repository.complete(payment.id);
        return {
          status: 'PROCESSED',
          reason: null,
          payment: toPaymentTransactionDto(completed ?? claimed),
        };
      }

      case 'FAILED':
      case 'EXPIRED': {
        if (payment.status === 'COMPLETED' || payment.status === 'REFUNDED') {
          return {
            status: 'IGNORED',
            reason: 'ALREADY_SETTLED',
            payment: toPaymentTransactionDto(payment),
          };
        }
        const row = await this.repository.markStatus(
          payment.id,
          payload.status,
          failureReasonFor(payload.status),
        );
        return {
          status: 'PROCESSED',
          reason: null,
          payment: toPaymentTransactionDto(row ?? payment),
        };
      }

      case 'REFUNDED': {
        if (payment.status !== 'COMPLETED') {
          return {
            status: 'IGNORED',
            reason: 'NOT_SETTLED',
            payment: toPaymentTransactionDto(payment),
          };
        }
        // Recorded for accounting. Reversing credits is an audited admin adjustment
        // (Phase 18), never an automatic side effect of a gateway notification.
        const row = await this.repository.markStatus(
          payment.id,
          'REFUNDED',
          'Refund diterima dari penyedia pembayaran.',
        );
        return {
          status: 'PROCESSED',
          reason: null,
          payment: toPaymentTransactionDto(row ?? payment),
        };
      }
    }
  }

  /** Marks overdue pending attempts as EXPIRED. Safe to call from a scheduler. */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    return this.repository.expireOverdue({ now });
  }

  async getForUser(userId: string, paymentId: string): Promise<PaymentTransactionDto> {
    await this.repository.expireOverdue({ userId }).catch(() => 0);
    const payment = await this.repository.findById(paymentId);
    if (!payment || payment.userId !== userId) {
      throw AppError.notFound('Transaksi pembayaran tidak ditemukan.');
    }
    return toPaymentTransactionDto(payment);
  }

  async listForUser(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: PaymentTransactionDto[]; total: number; page: number; pageSize: number }> {
    await this.repository.expireOverdue({ userId: input.userId }).catch(() => 0);
    const { items, total } = await this.repository.listForUser({
      userId: input.userId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });
    return {
      items: items.map(toPaymentTransactionDto),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  /**
   * Development-only settlement for the offline provider.
   *
   * Routes through the real webhook path with a correctly signed body, so the mock flow
   * exercises exactly the code a gateway would hit. Refuses to run in production or when
   * a real provider is active.
   */
  async simulateMockPayment(userId: string, paymentId: string): Promise<PaymentTransactionDto> {
    const provider = getPaymentProvider();
    if (provider.name !== 'mock' || env.isProduction) {
      throw AppError.notFound('Simulasi pembayaran tidak tersedia.');
    }

    const payment = await this.repository.findById(paymentId);
    if (!payment || payment.userId !== userId) {
      throw AppError.notFound('Transaksi pembayaran tidak ditemukan.');
    }
    if (payment.status === 'COMPLETED') {
      return toPaymentTransactionDto(payment);
    }
    if (
      payment.status === 'FAILED' ||
      payment.status === 'EXPIRED' ||
      payment.status === 'REFUNDED'
    ) {
      throw AppError.conflict('Pembayaran ini sudah tidak dapat disimulasikan lagi.');
    }

    const body = {
      providerTransactionId: payment.providerTransactionId ?? `MOCK-${payment.orderId}`,
      orderId: payment.orderId,
      amountIdr: payment.amountIdr,
      status: 'PAID' as const,
    };
    const signature = signMockWebhook(body, env.PAYMENT_MOCK_WEBHOOK_SECRET);

    await this.handleWebhook('mock', {
      headers: { [MOCK_WEBHOOK_SIGNATURE_HEADER]: signature },
      body,
    });

    // Re-read instead of trusting the webhook result: the row is the source of truth.
    const settled = await this.repository.findById(payment.id);
    if (!settled) {
      throw AppError.internal(new Error('Payment row disappeared during mock simulation.'));
    }
    return toPaymentTransactionDto(settled);
  }
}

export const paymentService = new PaymentService();
