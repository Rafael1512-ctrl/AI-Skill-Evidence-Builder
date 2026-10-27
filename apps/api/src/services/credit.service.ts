import {
  CREDIT_ECONOMY,
  type CostEstimate,
  type CreditTransaction,
  type CreditWallet,
  type FeatureKey,
} from '@aseb/shared';

import type {
  CreditReservation,
  CreditTransaction as PrismaCreditTransaction,
} from '../generated/prisma/client.js';
import { CreditRepository, type WalletRow } from '../repositories/credit.repository.js';
import { AppError } from '../utils/errors.js';
import { toIso } from '../utils/values.js';
import { pricingService, type PricingService } from './pricing.service.js';

export interface ReserveCreditsInput {
  userId: string;
  feature: FeatureKey;
  /** Number of units, e.g. 12 CVs. The cost is `unitPrice x quantity`. */
  quantity?: number;
  /** Explicit credit amount, used when the caller already computed a total. */
  credits?: number;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey?: string;
}

export interface SettleInput {
  reservationId: string;
  /** Units actually delivered; the charge is `min(reserved, unitPrice x units)`. */
  quantity?: number;
  credits?: number;
  description: string;
  idempotencyKey?: string;
}

/**
 * The single entry point for every credit movement.
 *
 * Flow for expensive work: ESTIMATE -> RESERVE -> EXECUTE -> SETTLE (or RELEASE).
 * Nothing else in the codebase may mutate a wallet.
 */
export class CreditService {
  constructor(
    private readonly repository = new CreditRepository(),
    private readonly pricing: PricingService = pricingService,
  ) {}

  private toWallet(row: WalletRow): CreditWallet {
    return {
      id: row.id,
      userId: row.userId,
      balance: row.balance,
      reserved: row.reserved,
      available: row.balance - row.reserved,
      lifetimeCreditsIn: row.lifetimeCreditsIn,
      lifetimeCreditsSpent: row.lifetimeCreditsSpent,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async ensureWallet(userId: string): Promise<CreditWallet> {
    const wallet = await this.repository.ensureWallet(userId);
    return this.toWallet(wallet);
  }

  async getWallet(userId: string): Promise<CreditWallet> {
    const wallet = await this.repository.getWallet(userId);
    if (!wallet) return this.ensureWallet(userId);
    return this.toWallet(wallet);
  }

  /** Preflight: how much would this cost, and can the user afford it? */
  async estimate(userId: string, feature: FeatureKey, quantity = 1): Promise<CostEstimate> {
    const wallet = await this.getWallet(userId);
    const unitCredits = await this.pricing.resolve(feature);
    const totalCredits = unitCredits * Math.max(1, quantity);
    const shortfall = Math.max(0, totalCredits - wallet.available);

    return {
      feature,
      quantity: Math.max(1, quantity),
      unitCredits,
      totalCredits,
      balance: wallet.balance,
      reserved: wallet.reserved,
      available: wallet.available,
      sufficient: totalCredits <= wallet.available,
      shortfall,
    };
  }

  /** Throws INSUFFICIENT_CREDITS unless the user can afford the operation right now. */
  async assertAffordable(userId: string, feature: FeatureKey, quantity = 1): Promise<CostEstimate> {
    const estimate = await this.estimate(userId, feature, quantity);
    if (!estimate.sufficient) {
      throw AppError.insufficientCredits(estimate.totalCredits, estimate.available);
    }
    return estimate;
  }

  /** Atomically holds credits for a pending operation. */
  async reserve(input: ReserveCreditsInput): Promise<CreditReservation> {
    const wallet = await this.repository.ensureWallet(input.userId);
    const credits = input.credits ?? (await this.pricing.resolveTotal(input.feature, input.quantity ?? 1));

    if (credits <= 0) {
      // Free features still get a reservation row so the flow stays uniform.
      const prisma = (await import('../db/prisma.js')).getPrisma();
      return prisma.creditReservation.create({
        data: {
          walletId: wallet.id,
          userId: input.userId,
          feature: input.feature,
          reservedCredits: 0,
          state: 'ACTIVE',
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    }

    const available = wallet.balance - wallet.reserved;
    if (credits > available) {
      throw AppError.insufficientCredits(credits, available);
    }

    return this.repository.createReservation({
      userId: input.userId,
      walletId: wallet.id,
      feature: input.feature,
      credits,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  }

  /**
   * Settles a reservation, charging only what was actually delivered.
   *
   * Partial-batch rule: unprocessed CVs are never charged, and their hold is
   * released. Failing before any billable AI usage releases everything.
   */
  async settle(input: SettleInput): Promise<{ charged: number; released: number; alreadySettled: boolean }> {
    const reservation = await this.repository.findReservation(input.reservationId);
    if (!reservation) throw AppError.notFound('Reservasi kredit tidak ditemukan.');

    let creditsCharged: number;
    if (typeof input.credits === 'number') {
      creditsCharged = Math.max(0, Math.trunc(input.credits));
    } else {
      const unitPrice = await this.pricing.resolve(reservation.feature as FeatureKey);
      creditsCharged = unitPrice * Math.max(0, Math.trunc(input.quantity ?? 0));
    }
    creditsCharged = Math.min(creditsCharged, reservation.reservedCredits);

    return this.repository.settleReservation({
      reservationId: input.reservationId,
      creditsCharged,
      description: input.description,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  }

  async release(reservationId: string, reason: string): Promise<{ released: number; alreadyReleased: boolean }> {
    return this.repository.releaseReservation({ reservationId, reason });
  }

  /** Credits a top-up. Idempotent when an idempotency key is supplied. */
  async grantTopUp(input: {
    userId: string;
    credits: number;
    amountIdr: number;
    paymentTransactionId: string;
  }): Promise<CreditTransaction> {
    const wallet = await this.repository.ensureWallet(input.userId);

    if (input.credits <= 0) {
      throw AppError.validation({ credits: input.credits }, 'Jumlah kredit top-up harus lebih dari nol.');
    }

    const result = await this.repository.applyDeltaWithLedger(
      {
        walletId: wallet.id,
        balanceDelta: input.credits,
        reservedDelta: 0,
        lifetimeInDelta: input.credits,
        context: { userId: input.userId, requestedCredits: 0 },
      },
      {
        type: 'TOP_UP',
        amount: input.credits,
        feature: null,
        description: `Top up ${input.credits} Kredit`,
        referenceType: 'payment',
        referenceId: input.paymentTransactionId,
        idempotencyKey: `payment:${input.paymentTransactionId}`,
      },
    );

    return toCreditTransactionDto(result.transaction);
  }

  /** Admin adjustment: positive grants credits, negative removes them. */
  async adjust(input: {
    userId: string;
    amount: number;
    reason: string;
    adminUserId: string;
  }): Promise<CreditTransaction> {
    const wallet = await this.repository.ensureWallet(input.userId);

    const result = await this.repository.applyDeltaWithLedger(
      {
        walletId: wallet.id,
        balanceDelta: input.amount,
        reservedDelta: 0,
        lifetimeInDelta: input.amount > 0 ? input.amount : 0,
        context: { userId: input.userId, requestedCredits: Math.max(0, -input.amount) },
      },
      {
        type: 'ADJUSTMENT',
        amount: input.amount,
        feature: null,
        description: input.reason,
        referenceType: 'admin_adjustment',
        referenceId: input.adminUserId,
        adjustedByUserId: input.adminUserId,
      },
    );

    return toCreditTransactionDto(result.transaction);
  }

  /** Refunds credits to a user, e.g. after a failed enhancement. */
  async refund(input: {
    userId: string;
    credits: number;
    description: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey?: string;
  }): Promise<CreditTransaction> {
    if (input.credits <= 0) {
      throw AppError.validation({ credits: input.credits }, 'Jumlah refund harus lebih dari nol.');
    }
    const wallet = await this.repository.ensureWallet(input.userId);

    const result = await this.repository.applyDeltaWithLedger(
      {
        walletId: wallet.id,
        balanceDelta: input.credits,
        reservedDelta: 0,
        lifetimeInDelta: input.credits,
        context: { userId: input.userId, requestedCredits: 0 },
      },
      {
        type: 'REFUND',
        amount: input.credits,
        feature: null,
        description: input.description,
        referenceType: input.referenceType ?? 'refund',
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    );

    return toCreditTransactionDto(result.transaction);
  }

  async listTransactions(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: CreditTransaction[]; total: number; page: number; pageSize: number }> {
    const { items, total } = await this.repository.listTransactions({
      userId: input.userId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });
    return {
      items: items.map(toCreditTransactionDto),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Admin aggregate helpers                                             */
  /* ------------------------------------------------------------------ */

  async totals(): Promise<{ outstanding: number; reserved: number }> {
    const [outstanding, reserved] = await Promise.all([
      this.repository.sumOutstanding(),
      this.repository.sumReserved(),
    ]);
    return { outstanding, reserved };
  }

  minTopUpIdr(): number {
    return CREDIT_ECONOMY.MIN_TOPUP_IDR;
  }

  creditsToIdr(credits: number): number {
    return credits * CREDIT_ECONOMY.CREDIT_IDR_VALUE;
  }
}

export const creditService = new CreditService();

export function toCreditTransactionDto(transaction: PrismaCreditTransaction): CreditTransaction {
  return {
    id: transaction.id,
    type: transaction.type,
    amount: transaction.amount,
    balanceAfter: transaction.balanceAfter,
    feature: transaction.feature,
    description: transaction.description,
    referenceType: transaction.referenceType,
    referenceId: transaction.referenceId,
    createdAt: toIso(transaction.createdAt) ?? new Date().toISOString(),
  };
}
