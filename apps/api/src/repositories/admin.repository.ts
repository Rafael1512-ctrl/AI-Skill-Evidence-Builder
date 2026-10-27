import type {
  CreditTransaction,
  PaymentTransaction,
  PaymentWebhookEvent,
  ScreeningCandidate,
  ScreeningJob,
  User,
  UserRole,
} from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';

/**
 * Admin reporting queries.
 *
 * Read-only aggregates plus the two audited write paths (role and credit adjustment). It is a
 * repository like any other: only this module may talk to Prisma, and the admin console gets no
 * shortcut around the invariants the feature services enforce.
 */

export interface AdminUserRow {
  user: User;
  balance: number;
  reserved: number;
}

export class AdminRepository {
  /* ------------------------------------------------------------------ */
  /* Overview aggregates                                                */
  /* ------------------------------------------------------------------ */

  async countUsers(input: { since?: Date | undefined } = {}): Promise<number> {
    return getPrisma().user.count({
      where: input.since ? { createdAt: { gte: input.since } } : {},
    });
  }

  async countUsersByRole(role: UserRole): Promise<number> {
    return getPrisma().user.count({ where: { role } });
  }

  async sumWallets(): Promise<{ balance: number; reserved: number }> {
    const result = await getPrisma().creditWallet.aggregate({
      _sum: { balance: true, reserved: true },
    });
    return { balance: result._sum.balance ?? 0, reserved: result._sum.reserved ?? 0 };
  }

  /** Credits entering and leaving the system in a window, from the ledger itself. */
  async sumLedger(input: { since: Date }): Promise<{ creditsIn: number; creditsSpent: number }> {
    const rows = await getPrisma().creditTransaction.groupBy({
      by: ['type'],
      where: { createdAt: { gte: input.since } },
      _sum: { amount: true },
    });

    const amountOf = (type: string) => rows.find((row) => row.type === type)?._sum.amount ?? 0;

    return {
      creditsIn: amountOf('TOP_UP') + amountOf('ADJUSTMENT') + amountOf('REFUND'),
      creditsSpent: Math.abs(amountOf('USAGE')),
    };
  }

  async sumPayments(input: { since: Date }): Promise<{
    paidIdr: number;
    paidCount: number;
    pendingIdr: number;
  }> {
    const [paid, pending] = await Promise.all([
      getPrisma().paymentTransaction.aggregate({
        where: { status: { in: ['PAID', 'COMPLETED'] }, createdAt: { gte: input.since } },
        _sum: { amountIdr: true },
        _count: { _all: true },
      }),
      getPrisma().paymentTransaction.aggregate({
        where: { status: { in: ['CREATED', 'PENDING', 'PROCESSING'] } },
        _sum: { amountIdr: true },
      }),
    ]);

    return {
      paidIdr: paid._sum.amountIdr ?? 0,
      paidCount: paid._count._all,
      pendingIdr: pending._sum.amountIdr ?? 0,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Lists                                                              */
  /* ------------------------------------------------------------------ */

  async listUsers(input: {
    search?: string | undefined;
    role?: UserRole | undefined;
    skip: number;
    take: number;
  }): Promise<{ items: AdminUserRow[]; total: number }> {
    const where = {
      ...(input.role ? { role: input.role } : {}),
      ...(input.search
        ? {
            OR: [
              { email: { contains: input.search, mode: 'insensitive' as const } },
              { fullName: { contains: input.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      getPrisma().user.findMany({
        where,
        include: { wallet: { select: { balance: true, reserved: true } } },
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().user.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        user: row,
        balance: row.wallet?.balance ?? 0,
        reserved: row.wallet?.reserved ?? 0,
      })),
      total,
    };
  }

  async listTransactions(input: { skip: number; take: number }): Promise<{
    items: CreditTransaction[];
    total: number;
  }> {
    const [items, total] = await Promise.all([
      getPrisma().creditTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().creditTransaction.count(),
    ]);
    return { items, total };
  }

  async listPayments(input: { skip: number; take: number }): Promise<{
    items: PaymentTransaction[];
    total: number;
  }> {
    const [items, total] = await Promise.all([
      getPrisma().paymentTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().paymentTransaction.count(),
    ]);
    return { items, total };
  }

  async listWebhookEvents(input: { skip: number; take: number }): Promise<{
    items: PaymentWebhookEvent[];
    total: number;
  }> {
    const [items, total] = await Promise.all([
      getPrisma().paymentWebhookEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().paymentWebhookEvent.count(),
    ]);
    return { items, total };
  }

  async listScreeningJobs(input: { skip: number; take: number }): Promise<{
    items: Array<ScreeningJob & { user: Pick<User, 'id' | 'email' | 'fullName'> }>;
    total: number;
  }> {
    const [items, total] = await Promise.all([
      getPrisma().screeningJob.findMany({
        include: { user: { select: { id: true, email: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().screeningJob.count(),
    ]);
    return { items, total };
  }

  /** Candidates that failed, with the job they belong to: the "failed jobs" view. */
  async listFailedCandidates(input: { skip: number; take: number }): Promise<{
    items: Array<ScreeningCandidate & { job: Pick<ScreeningJob, 'id' | 'title' | 'userId'> }>;
    total: number;
  }> {
    const where = { state: 'FAILED' as const };
    const [items, total] = await Promise.all([
      getPrisma().screeningCandidate.findMany({
        where,
        include: { job: { select: { id: true, title: true, userId: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().screeningCandidate.count({ where }),
    ]);
    return { items, total };
  }

  async countCandidates(): Promise<{ total: number; failed: number }> {
    const [total, failed] = await Promise.all([
      getPrisma().screeningCandidate.count(),
      getPrisma().screeningCandidate.count({ where: { state: 'FAILED' } }),
    ]);
    return { total, failed };
  }

  async countActiveJobs(): Promise<number> {
    return getPrisma().screeningJob.count({
      where: { state: { in: ['CREATED', 'VALIDATING', 'QUEUED', 'PROCESSING'] } },
    });
  }

  async countTestimonials(): Promise<{ pending: number; approved: number; rejected: number }> {
    const rows = await getPrisma().testimonial.groupBy({ by: ['status'], _count: { _all: true } });
    const countOf = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;
    return {
      pending: countOf('PENDING'),
      approved: countOf('APPROVED'),
      rejected: countOf('REJECTED'),
    };
  }

  /** Database reachability, answered without throwing at the caller. */
  async ping(): Promise<boolean> {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Audited writes                                                      */
  /* ------------------------------------------------------------------ */

  async findUserById(userId: string): Promise<User | null> {
    return getPrisma().user.findUnique({ where: { id: userId } });
  }

  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    return getPrisma().user.update({ where: { id: userId }, data: { role } });
  }
}

export const adminRepository = new AdminRepository();
