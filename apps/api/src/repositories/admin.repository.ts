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

export interface AdminRevenueReportRow {
  createdAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  amountIdr: number;
  credits: number;
}

export interface AdminAiUsageReportRow {
  createdAt: Date;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: unknown;
  creditsCharged: number;
  success: boolean;
}

export interface AdminUserCreditAggregate {
  userId: string;
  type: 'TOP_UP' | 'USAGE';
  amount: number;
  count: number;
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
  /* Filterable reports                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Paid payments whose money date falls in the requested range.
   *
   * Revenue is recognised on `paidAt` (falling back to completion/creation for imported rows),
   * not on when the row happened to be created.
   */
  async listRevenueReportRows(input: { start: Date; end: Date }): Promise<AdminRevenueReportRow[]> {
    return getPrisma().paymentTransaction.findMany({
      where: {
        status: { in: ['PAID', 'COMPLETED'] },
        OR: [
          { paidAt: { gte: input.start, lt: input.end } },
          { completedAt: { gte: input.start, lt: input.end } },
          {
            paidAt: null,
            completedAt: null,
            createdAt: { gte: input.start, lt: input.end },
          },
        ],
      },
      select: {
        createdAt: true,
        paidAt: true,
        completedAt: true,
        amountIdr: true,
        credits: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listAiUsageReportRows(input: {
    start: Date;
    end: Date;
    feature?: string | undefined;
  }): Promise<AdminAiUsageReportRow[]> {
    return getPrisma().aiUsageRecord.findMany({
      where: {
        createdAt: { gte: input.start, lt: input.end },
        ...(input.feature ? { feature: input.feature } : {}),
      },
      select: {
        createdAt: true,
        requestCount: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        estimatedCostUsd: true,
        creditsCharged: true,
        success: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async aggregateUserCreditsReport(input: {
    start: Date;
    end: Date;
  }): Promise<AdminUserCreditAggregate[]> {
    const rows = await getPrisma().creditTransaction.groupBy({
      by: ['userId', 'type'],
      where: {
        createdAt: { gte: input.start, lt: input.end },
        type: { in: ['TOP_UP', 'USAGE'] },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return rows.map((row) => ({
      userId: row.userId,
      type: row.type as 'TOP_UP' | 'USAGE',
      amount: row._sum.amount ?? 0,
      count: row._count._all,
    }));
  }

  async listMatchingUserIds(search?: string | undefined): Promise<string[]> {
    const rows = await getPrisma().user.findMany({
      where: search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { fullName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listReportUsers(userIds: string[]): Promise<AdminUserRow[]> {
    if (userIds.length === 0) return [];

    const rows = await getPrisma().user.findMany({
      where: { id: { in: userIds } },
      include: { wallet: { select: { balance: true, reserved: true } } },
    });

    return rows.map((row) => ({
      user: row,
      balance: row.wallet?.balance ?? 0,
      reserved: row.wallet?.reserved ?? 0,
    }));
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
