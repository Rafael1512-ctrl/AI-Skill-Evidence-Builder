import type {
  PaymentStatus,
  PaymentTransaction,
  PaymentWebhookEvent,
  Prisma,
} from '../generated/prisma/client.js';
import { Prisma as PrismaNamespace } from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';

export interface CreatePaymentTransactionInput {
  userId: string;
  provider: string;
  orderId: string;
  credits: number;
  amountIdr: number;
  expiresAt: Date | null;
}

export interface ApplyProviderResultInput {
  providerTransactionId: string | null;
  providerReference: string | null;
  paymentUrl: string | null;
  qrString: string | null;
  expiresAt: Date | null;
}

export interface RecordWebhookEventInput {
  provider: string;
  eventKey: string;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
}

/** JSON columns reject `undefined`; normalise to a JSON-safe object first. */
function toJson(value: unknown): Prisma.InputJsonValue {
  const normalized: unknown = JSON.parse(JSON.stringify(value ?? {}));
  return (
    normalized !== null && typeof normalized === 'object' ? normalized : { raw: normalized }
  ) as Prisma.InputJsonValue;
}

/**
 * Payment persistence.
 *
 * The only module that touches `payment_transactions` / `payment_webhook_events`.
 * Status transitions are expressed as conditional `updateMany` calls so two concurrent
 * notifications can never both "win" a transition: the loser sees `count === 0` and the
 * caller treats it as already handled.
 */
export class PaymentRepository {
  async create(input: CreatePaymentTransactionInput): Promise<PaymentTransaction> {
    return getPrisma().paymentTransaction.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        orderId: input.orderId,
        credits: input.credits,
        amountIdr: input.amountIdr,
        status: 'PENDING',
        expiresAt: input.expiresAt,
      },
    });
  }

  async findById(id: string): Promise<PaymentTransaction | null> {
    return getPrisma().paymentTransaction.findUnique({ where: { id } });
  }

  async findByOrderId(orderId: string): Promise<PaymentTransaction | null> {
    return getPrisma().paymentTransaction.findUnique({ where: { orderId } });
  }

  async listForUser(input: {
    userId: string;
    skip: number;
    take: number;
  }): Promise<{ items: PaymentTransaction[]; total: number }> {
    const [items, total] = await Promise.all([
      getPrisma().paymentTransaction.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().paymentTransaction.count({ where: { userId: input.userId } }),
    ]);
    return { items, total };
  }

  /** Records who the provider says it is, once checkout has succeeded. */
  async applyProviderResult(
    id: string,
    input: ApplyProviderResultInput,
  ): Promise<PaymentTransaction | null> {
    await getPrisma().paymentTransaction.updateMany({
      where: { id },
      data: {
        providerTransactionId: input.providerTransactionId,
        providerReference: input.providerReference,
        paymentUrl: input.paymentUrl,
        qrString: input.qrString,
        expiresAt: input.expiresAt,
      },
    });
    return this.findById(id);
  }

  /**
   * Claims a payment for settlement.
   *
   * Allowed from any non-terminal state plus `EXPIRED`: expiry is a local, time-based
   * guess, while a signature-verified settlement notification is authoritative.
   * `FAILED` is excluded because checkout never reached the gateway, and a completed or
   * refunded payment must never be re-credited.
   */
  async claimPaid(
    id: string,
    input: { paidAt: Date; providerTransactionId: string | null; providerReference: string | null },
  ): Promise<PaymentTransaction | null> {
    const updated = await getPrisma().paymentTransaction.updateMany({
      where: {
        id,
        completedAt: null,
        status: { in: ['CREATED', 'PENDING', 'PAID', 'PROCESSING', 'EXPIRED'] },
      },
      data: {
        status: 'PAID',
        paidAt: input.paidAt,
        ...(input.providerTransactionId
          ? { providerTransactionId: input.providerTransactionId }
          : {}),
        ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      },
    });
    if (updated.count === 0) return null;
    return this.findById(id);
  }

  /** Marks the payment as fully settled after the ledger grant has been written. */
  async complete(id: string): Promise<PaymentTransaction | null> {
    await getPrisma().paymentTransaction.updateMany({
      where: { id, completedAt: null, status: { in: ['PAID', 'PROCESSING'] } },
      data: { status: 'COMPLETED', completedAt: new Date(), failureReason: null },
    });
    return this.findById(id);
  }

  /**
   * Terminal transition for failure/expiry/refund.
   *
   * Never downgrades a completed payment into FAILED/EXPIRED. A refund is only accepted
   * from COMPLETED and deliberately does not reverse credits automatically.
   */
  async markStatus(
    id: string,
    status: PaymentStatus,
    failureReason?: string | null,
  ): Promise<PaymentTransaction | null> {
    const where: Prisma.PaymentTransactionWhereInput =
      status === 'REFUNDED'
        ? { id, status: 'COMPLETED' }
        : status === 'FAILED' || status === 'EXPIRED'
          ? { id, completedAt: null, status: { in: ['CREATED', 'PENDING', 'PAID', 'PROCESSING'] } }
          : { id, completedAt: null };

    const updated = await getPrisma().paymentTransaction.updateMany({
      where,
      data: { status, failureReason: failureReason ?? null },
    });
    if (updated.count === 0) return null;
    return this.findById(id);
  }

  /** Moves overdue pending attempts to EXPIRED. Returns how many rows changed. */
  async expireOverdue(input: { now?: Date; userId?: string } = {}): Promise<number> {
    const now = input.now ?? new Date();
    const result = await getPrisma().paymentTransaction.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: now },
        ...(input.userId ? { userId: input.userId } : {}),
      },
      data: {
        status: 'EXPIRED',
        failureReason: 'Batas waktu pembayaran terlewat.',
      },
    });
    return result.count;
  }

  async findWebhookEventByKey(eventKey: string): Promise<PaymentWebhookEvent | null> {
    return getPrisma().paymentWebhookEvent.findUnique({ where: { eventKey } });
  }

  /**
   * Persists a delivery before it is processed, exactly once per `event_key`.
   *
   * `created: false` means the delivery was already recorded. The caller inspects
   * `event.processed` to distinguish a genuine redelivery (drop it) from a retry of a
   * delivery that failed mid-processing (re-run it - every step is idempotent).
   */
  async upsertWebhookEvent(
    input: RecordWebhookEventInput,
  ): Promise<{ event: PaymentWebhookEvent; created: boolean }> {
    const existing = await this.findWebhookEventByKey(input.eventKey);
    if (existing) return { event: existing, created: false };

    try {
      const created = await getPrisma().paymentWebhookEvent.create({
        data: {
          provider: input.provider,
          eventKey: input.eventKey,
          eventType: input.eventType,
          payload: toJson(input.payload),
          signatureValid: input.signatureValid,
        },
      });
      return { event: created, created: true };
    } catch (error) {
      if (
        error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.findWebhookEventByKey(input.eventKey);
        if (raced) return { event: raced, created: false };
      }
      throw error;
    }
  }

  async markWebhookEvent(
    id: string,
    input: {
      processed: boolean;
      paymentTransactionId?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    await getPrisma().paymentWebhookEvent.updateMany({
      where: { id },
      data: {
        processed: input.processed,
        processedAt: new Date(),
        errorMessage: input.errorMessage ?? null,
        ...(input.paymentTransactionId !== undefined
          ? { paymentTransactionId: input.paymentTransactionId }
          : {}),
      },
    });
  }
}
