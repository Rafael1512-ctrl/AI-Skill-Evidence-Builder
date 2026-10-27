import type { CreditTransaction, CreditTransactionType, Prisma, ReservationState } from '../generated/prisma/client.js';
import { Prisma as PrismaNamespace } from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';
import { AppError } from '../utils/errors.js';
import { toInt } from '../utils/values.js';

export interface WalletRow {
  id: string;
  userId: string;
  balance: number;
  reserved: number;
  lifetimeCreditsIn: number;
  lifetimeCreditsSpent: number;
  updatedAt: Date;
}

export interface ApplyDeltaInput {
  walletId: string;
  /** Signed change to the owned-credit balance. */
  balanceDelta: number;
  /** Signed change to the reserved-credit counter. */
  reservedDelta: number;
  lifetimeInDelta?: number;
  lifetimeSpentDelta?: number;
  /** When the atomic update matches no row, this is what the user was short of. */
  context: { userId: string; requestedCredits: number };
}

export interface LedgerEntryInput {
  walletId: string;
  userId: string;
  type: CreditTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  feature?: string | null;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  adjustedByUserId?: string | null;
}

export interface WalletDeltaResult {
  wallet: WalletRow;
  transaction: CreditTransaction;
}

const walletSelect = PrismaNamespace.sql`
  id,
  user_id as "userId",
  balance,
  reserved,
  lifetime_credits_in as "lifetimeCreditsIn",
  lifetime_credits_spent as "lifetimeCreditsSpent",
  updated_at as "updatedAt"
`;

/**
 * Credit persistence.
 *
 * Every balance change is a single conditional UPDATE, executed inside a transaction:
 *
 *   UPDATE credit_wallets
 *      SET balance = balance + :balanceDelta,
 *          reserved = reserved + :reservedDelta
 *    WHERE id = :walletId
 *      AND balance + :balanceDelta >= 0
 *      AND reserved + :reservedDelta >= 0
 *      AND balance + :balanceDelta >= reserved + :reservedDelta
 *
 * The `WHERE` clause is the concurrency guard: two simultaneous requests can never
 * drive the available balance below zero, and the loser receives INSUFFICIENT_CREDITS
 * instead of a negative wallet. The ledger row is written from the values returned by
 * the same statement, so `balanceAfter` is always exact.
 */
export class CreditRepository {
  async ensureWallet(userId: string, tx?: Prisma.TransactionClient): Promise<WalletRow> {
    const client = tx ?? getPrisma();
    const existing = await client.$queryRaw<WalletRow[]>(PrismaNamespace.sql`
      SELECT ${walletSelect} FROM credit_wallets WHERE user_id = ${userId} LIMIT 1
    `);
    if (existing[0]) return existing[0];

    const created = await client.creditWallet.create({
      data: { userId },
      select: { id: true, userId: true, balance: true, reserved: true, lifetimeCreditsIn: true, lifetimeCreditsSpent: true, updatedAt: true },
    });
    return created;
  }

  async getWallet(userId: string, tx?: Prisma.TransactionClient): Promise<WalletRow | null> {
    const client = tx ?? getPrisma();
    const rows = await client.$queryRaw<WalletRow[]>(PrismaNamespace.sql`
      SELECT ${walletSelect} FROM credit_wallets WHERE user_id = ${userId} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async findTransactionByIdempotencyKey(key: string): Promise<CreditTransaction | null> {
    return getPrisma().creditTransaction.findUnique({ where: { idempotencyKey: key } });
  }

  /**
   * Applies a balance change atomically and writes the matching ledger row.
   * Throws INSUFFICIENT_CREDITS when the guard rejects the update.
   */
  async applyDeltaWithLedger(
    input: ApplyDeltaInput,
    ledger: Omit<LedgerEntryInput, 'walletId' | 'userId' | 'balanceBefore' | 'balanceAfter' | 'amount'> & {
      amount: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<WalletDeltaResult> {
    const run = async (client: Prisma.TransactionClient): Promise<WalletDeltaResult> => {
      // Idempotency: a retried operation must not move credits twice.
      if (ledger.idempotencyKey) {
        const existing = await client.creditTransaction.findUnique({
          where: { idempotencyKey: ledger.idempotencyKey },
        });
        if (existing) {
          const current = await this.getWallet(existing.userId, client);
          return {
            wallet:
              current ?? {
                id: existing.walletId,
                userId: existing.userId,
                balance: existing.balanceAfter,
                reserved: 0,
                lifetimeCreditsIn: 0,
                lifetimeCreditsSpent: 0,
                updatedAt: existing.createdAt,
              },
            transaction: existing,
          };
        }
      }

      const balanceDelta = input.balanceDelta;
      const reservedDelta = input.reservedDelta;

      const updated = await client.$queryRaw<WalletRow[]>(PrismaNamespace.sql`
        UPDATE credit_wallets
           SET balance = balance + ${balanceDelta},
               reserved = reserved + ${reservedDelta},
               lifetime_credits_in = lifetime_credits_in + ${input.lifetimeInDelta ?? 0},
               lifetime_credits_spent = lifetime_credits_spent + ${input.lifetimeSpentDelta ?? 0},
               updated_at = now()
         WHERE id = ${input.walletId}
           AND balance + ${balanceDelta} >= 0
           AND reserved + ${reservedDelta} >= 0
           AND balance + ${balanceDelta} >= reserved + ${reservedDelta}
        RETURNING ${walletSelect}
      `);

      const wallet = updated[0];
      if (!wallet) {
        const current = await client.$queryRaw<WalletRow[]>(PrismaNamespace.sql`
          SELECT ${walletSelect} FROM credit_wallets WHERE id = ${input.walletId}
        `);
        const available = (current[0]?.balance ?? 0) - (current[0]?.reserved ?? 0);
        throw AppError.insufficientCredits(input.context.requestedCredits, available);
      }

      const transaction = await client.creditTransaction.create({
        data: {
          walletId: wallet.id,
          userId: input.context.userId,
          type: ledger.type,
          amount: ledger.amount,
          balanceBefore: wallet.balance - balanceDelta,
          balanceAfter: wallet.balance,
          feature: ledger.feature ?? null,
          description: ledger.description,
          referenceType: ledger.referenceType ?? null,
          referenceId: ledger.referenceId ?? null,
          idempotencyKey: ledger.idempotencyKey ?? null,
          adjustedByUserId: ledger.adjustedByUserId ?? null,
        },
      });

      return { wallet, transaction };
    };

    if (tx) return run(tx);
    return getPrisma().$transaction(run);
  }

  /**
   * Reserves credits for an expensive operation.
   *
   * A reservation does not change the owned balance, so it does not produce a
   * `-N Kredit` ledger line: the reservation row itself is the audit trail, and the
   * actual charge is written when the operation settles.
   */
  async createReservation(
    input: {
      userId: string;
      walletId: string;
      feature: string;
      credits: number;
      referenceType?: string | null;
      referenceId?: string | null;
      idempotencyKey?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (client: Prisma.TransactionClient) => {
      if (input.idempotencyKey) {
        const existing = await client.creditReservation.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) return existing;
      }

      await client.$queryRaw<WalletRow[]>(PrismaNamespace.sql`
        UPDATE credit_wallets
           SET reserved = reserved + ${input.credits}, updated_at = now()
         WHERE id = ${input.walletId}
           AND reserved + ${input.credits} >= 0
           AND balance >= reserved + ${input.credits}
        RETURNING ${walletSelect}
      `).then((rows) => {
        if (rows.length === 0) {
          throw AppError.insufficientCredits(input.credits, 0);
        }
      });

      return client.creditReservation.create({
        data: {
          walletId: input.walletId,
          userId: input.userId,
          feature: input.feature,
          reservedCredits: input.credits,
          state: 'ACTIVE',
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    };

    if (tx) return run(tx);
    return getPrisma().$transaction(run);
  }

  async findReservation(reservationId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? getPrisma();
    return client.creditReservation.findUnique({ where: { id: reservationId } });
  }

  /**
   * Settles a reservation: releases the hold and charges the final amount in one
   * atomic step, then writes the `USAGE` ledger row.
   */
  async settleReservation(
    input: {
      reservationId: string;
      creditsCharged: number;
      description: string;
      ledgerType?: Extract<CreditTransactionType, 'USAGE' | 'REFUND'>;
      idempotencyKey?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ charged: number; released: number; alreadySettled: boolean }> {
    const run = async (client: Prisma.TransactionClient) => {
      const reservations = await client.$queryRaw<
        Array<{ id: string; walletId: string; userId: string; feature: string; reservedCredits: number; state: ReservationState; settledCredits: number | null }>
      >(PrismaNamespace.sql`
        SELECT id,
               wallet_id as "walletId",
               user_id as "userId",
               feature,
               reserved_credits as "reservedCredits",
               state,
               settled_credits as "settledCredits"
          FROM credit_reservations
         WHERE id = ${input.reservationId}
           FOR UPDATE
      `);

      const reservation = reservations[0];
      if (!reservation) throw AppError.notFound('Reservasi kredit tidak ditemukan.');

      if (reservation.state !== 'ACTIVE') {
        return {
          charged: toInt(reservation.settledCredits),
          released: reservation.reservedCredits - toInt(reservation.settledCredits),
          alreadySettled: true,
        };
      }

      const charge = Math.min(Math.max(input.creditsCharged, 0), reservation.reservedCredits);
      const release = reservation.reservedCredits - charge;

      const { wallet } = await this.applyDeltaWithLedger(
        {
          walletId: reservation.walletId,
          balanceDelta: -charge,
          reservedDelta: -reservation.reservedCredits,
          lifetimeSpentDelta: charge,
          context: { userId: reservation.userId, requestedCredits: charge },
        },
        {
          type: input.ledgerType ?? 'USAGE',
          amount: -charge,
          feature: reservation.feature,
          description: input.description,
          referenceType: 'reservation',
          referenceId: reservation.id,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        client,
      );

      await client.creditReservation.update({
        where: { id: reservation.id },
        data: { state: 'SETTLED', settledCredits: charge, settledAt: new Date() },
      });

      if (wallet.balance < 0) {
        // Defensive: the guard above makes this impossible, but never persist a negative wallet.
        throw AppError.internal(new Error('Credit invariant violated: negative balance after settlement'));
      }

      return { charged: charge, released: release, alreadySettled: false };
    };

    if (tx) return run(tx);
    return getPrisma().$transaction(run);
  }

  /** Releases an unused (or fully failed) reservation without charging anything. */
  async releaseReservation(
    input: { reservationId: string; reason: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ released: number; alreadyReleased: boolean }> {
    const run = async (client: Prisma.TransactionClient) => {
      const reservations = await client.$queryRaw<
        Array<{ id: string; walletId: string; reservedCredits: number; state: ReservationState }>
      >(PrismaNamespace.sql`
        SELECT id, wallet_id as "walletId", reserved_credits as "reservedCredits", state
          FROM credit_reservations
         WHERE id = ${input.reservationId}
           FOR UPDATE
      `);

      const reservation = reservations[0];
      if (!reservation) throw AppError.notFound('Reservasi kredit tidak ditemukan.');
      if (reservation.state !== 'ACTIVE') {
        return { released: 0, alreadyReleased: true };
      }

      await client.$queryRaw<WalletRow[]>(PrismaNamespace.sql`
        UPDATE credit_wallets
           SET reserved = reserved - ${reservation.reservedCredits}, updated_at = now()
         WHERE id = ${reservation.walletId}
           AND reserved >= ${reservation.reservedCredits}
        RETURNING ${walletSelect}
      `);

      await client.creditReservation.update({
        where: { id: reservation.id },
        data: { state: 'RELEASED', settledAt: new Date() },
      });

      return { released: reservation.reservedCredits, alreadyReleased: false };
    };

    if (tx) return run(tx);
    return getPrisma().$transaction(run);
  }

  async listTransactions(input: {
    userId: string;
    skip: number;
    take: number;
  }): Promise<{ items: CreditTransaction[]; total: number }> {
    const prisma = getPrisma();
    const [items, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      prisma.creditTransaction.count({ where: { userId: input.userId } }),
    ]);
    return { items, total };
  }

  async sumOutstanding(): Promise<number> {
    const rows = await getPrisma().$queryRaw<Array<{ total: string }>>(PrismaNamespace.sql`
      SELECT COALESCE(SUM(balance), 0)::text AS total FROM credit_wallets
    `);
    return toInt(rows[0]?.total);
  }

  async sumReserved(): Promise<number> {
    const rows = await getPrisma().$queryRaw<Array<{ total: string }>>(PrismaNamespace.sql`
      SELECT COALESCE(SUM(reserved), 0)::text AS total FROM credit_wallets
    `);
    return toInt(rows[0]?.total);
  }

  async sumCreditsByTypeSince(type: CreditTransactionType, since: Date): Promise<number> {
    const rows = await getPrisma().$queryRaw<Array<{ total: string }>>(PrismaNamespace.sql`
      SELECT COALESCE(SUM(amount), 0)::text AS total
        FROM credit_transactions
       WHERE type = ${type}::"CreditTransactionType" AND created_at >= ${since}
    `);
    return toInt(rows[0]?.total);
  }

  async countActiveReservations(): Promise<number> {
    return getPrisma().creditReservation.count({ where: { state: 'ACTIVE' } });
  }
}
