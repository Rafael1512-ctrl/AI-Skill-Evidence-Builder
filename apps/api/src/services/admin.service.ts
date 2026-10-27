import type {
  AdminOverview,
  AdminUserListQuery,
  AiUsageSummaryQuery,
  CreditAdjustmentInput,
  FeaturePricing as FeaturePricingDto,
  PaginationQuery,
  UserRoleUpdateInput,
} from '@aseb/shared';
import { DEFAULT_FEATURE_PRICING, type FeatureKey } from '@aseb/shared';

import { env } from '../config/env.js';
import { AdminRepository } from '../repositories/admin.repository.js';
import { getScreeningQueue } from '../queues/index.js';
import { AppError } from '../utils/errors.js';
import { toIso } from '../utils/values.js';
import {
  listAiUsage,
  summariseAiUsageByFeatureSince,
  summariseAiUsageSince,
} from './ai-usage.service.js';
import { creditService, type CreditService } from './credit.service.js';
import { pricingService, type PricingService } from './pricing.service.js';

const OVERVIEW_WINDOW_DAYS = 30;
const SIGNUP_WINDOW_DAYS = 7;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

/**
 * Admin reporting and the two audited mutations (Phase 18).
 *
 * Everything here is read-only except the role change and the credit adjustment, and the
 * credit adjustment goes through the ledger like every other balance movement: an admin gets
 * no second way to write a wallet. Prices are changed through the pricing service, so the
 * shared defaults and the cache stay the single source of truth.
 */
export class AdminService {
  constructor(
    private readonly repository = new AdminRepository(),
    private readonly pricing: PricingService = pricingService,
    private readonly credits: CreditService = creditService,
  ) {}

  async overview(): Promise<AdminOverview> {
    const windowStart = daysAgo(OVERVIEW_WINDOW_DAYS);

    const [
      users,
      newUsers,
      admins,
      wallets,
      ledger,
      payments,
      usage,
      usageByFeature,
      jobs,
      activeJobs,
      candidates,
      testimonials,
      databaseUp,
    ] = await Promise.all([
      this.repository.countUsers(),
      this.repository.countUsers({ since: daysAgo(SIGNUP_WINDOW_DAYS) }),
      this.repository.countUsersByRole('ADMIN'),
      this.repository.sumWallets(),
      this.repository.sumLedger({ since: windowStart }),
      this.repository.sumPayments({ since: windowStart }),
      summariseAiUsageSince(windowStart),
      summariseAiUsageByFeatureSince(windowStart),
      this.repository.listScreeningJobs({ skip: 0, take: 1 }),
      this.repository.countActiveJobs(),
      this.repository.countCandidates(),
      this.repository.countTestimonials(),
      this.repository.ping(),
    ]);

    const queue = getScreeningQueue();

    return {
      users: { total: users, newLast7Days: newUsers, admins },
      credits: {
        outstanding: wallets.balance,
        reserved: wallets.reserved,
        creditsInLast30Days: ledger.creditsIn,
        creditsSpentLast30Days: ledger.creditsSpent,
      },
      revenue: {
        paidIdrLast30Days: payments.paidIdr,
        pendingIdr: payments.pendingIdr,
        paidTransactionsLast30Days: payments.paidCount,
      },
      ai: {
        requestsLast30Days: usage.requests,
        estimatedCostUsdLast30Days: usage.estimatedCostUsd,
        targetRevenueUsdLast30Days: usage.targetRevenueUsd,
        tokensLast30Days: {
          input: usage.inputTokens,
          output: usage.outputTokens,
          cached: usage.cachedTokens,
        },
        byFeature: usageByFeature.slice(0, 10),
      },
      screening: {
        totalJobs: jobs.total,
        activeJobs,
        failedCandidates: candidates.failed,
        totalCandidates: candidates.total,
        failureRate: candidates.total === 0 ? 0 : Math.min(1, candidates.failed / candidates.total),
      },
      testimonials,
      system: {
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        database: databaseUp ? 'connected' : 'unavailable',
        redis: env.REDIS_URL ? 'connected' : 'in-process',
        aiProvider: env.AI_PROVIDER,
        paymentProvider: env.PAYMENT_PROVIDER,
        queueDriver: queue.driver,
        environment: env.NODE_ENV,
      },
    };
  }

  /** Never returns password hashes or provider secrets: only the fields the console needs. */
  async listUsers(query: AdminUserListQuery) {
    const { items, total } = await this.repository.listUsers({
      search: query.search,
      role: query.role,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => ({
        id: row.user.id,
        email: row.user.email,
        fullName: row.user.fullName,
        role: row.user.role,
        isActive: row.user.isActive,
        emailVerified: row.user.emailVerified,
        balance: row.balance,
        reserved: row.reserved,
        createdAt: row.user.createdAt.toISOString(),
        updatedAt: row.user.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listTransactions(query: PaginationQuery) {
    const { items, total } = await this.repository.listTransactions({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        type: row.type,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        feature: row.feature,
        description: row.description,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listPayments(query: PaginationQuery) {
    const { items, total } = await this.repository.listPayments({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        provider: row.provider,
        orderId: row.orderId,
        status: row.status,
        amountIdr: row.amountIdr,
        credits: row.credits,
        failureReason: row.failureReason,
        paidAt: toIso(row.paidAt),
        expiresAt: toIso(row.expiresAt),
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Webhook deliveries, including the ones that failed verification or processing. */
  async listWebhookEvents(query: PaginationQuery) {
    const { items, total } = await this.repository.listWebhookEvents({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        provider: row.provider,
        eventType: row.eventType,
        paymentTransactionId: row.paymentTransactionId,
        signatureValid: row.signatureValid,
        processed: row.processed,
        errorMessage: row.errorMessage,
        receivedAt: row.receivedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Provider cost and margin per call, never user-facing pricing. */
  async listAiUsage(query: AiUsageSummaryQuery) {
    const { items, total } = await listAiUsage({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      feature: query.feature,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        feature: row.feature,
        provider: row.provider,
        model: row.model,
        promptVersion: row.promptVersion,
        requestCount: row.requestCount,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cachedTokens: row.cachedTokens,
        estimatedCostUsd: row.estimatedCostUsd === null ? null : Number(row.estimatedCostUsd),
        targetRevenueUsd: row.targetRevenueUsd === null ? null : Number(row.targetRevenueUsd),
        creditsCharged: row.creditsCharged,
        success: row.success,
        latencyMs: row.latencyMs,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listJobs(query: PaginationQuery) {
    const { items, total } = await this.repository.listScreeningJobs({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        ownerEmail: row.user.email,
        title: row.title,
        state: row.state,
        totalCandidates: row.totalCandidates,
        completedCandidates: row.completedCandidates,
        failedCandidates: row.failedCandidates,
        creditsCharged: row.creditsCharged,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The "failed jobs" view: which candidates failed and in which batch. */
  async listFailedCandidates(query: PaginationQuery) {
    const { items, total } = await this.repository.listFailedCandidates({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        jobTitle: row.job.title,
        userId: row.job.userId,
        candidateName: row.candidateName,
        fileName: row.fileName,
        attempts: row.attempts,
        failureReason: row.failureReason,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  listPricing(): Promise<FeaturePricingDto[]> {
    return this.pricing.listAll();
  }

  /** Price changes go through the pricing service; the shared defaults are the guard rail. */
  async updatePricing(input: {
    feature: string;
    credits: number;
    adminUserId: string;
  }): Promise<FeaturePricingDto> {
    return this.pricing.update(input.feature, input.credits, input.adminUserId);
  }

  /** The defaults, so the console can show what an override is changing. */
  pricingDefaults(): Array<{ feature: FeatureKey; credits: number }> {
    return Object.entries(DEFAULT_FEATURE_PRICING).map(([feature, definition]) => ({
      feature: feature as FeatureKey,
      credits: definition.credits,
    }));
  }

  async updateUserRole(input: { userId: string; adminUserId: string; body: UserRoleUpdateInput }) {
    if (input.userId === input.adminUserId && input.body.role !== 'ADMIN') {
      // Removing your own admin role locks the console for everyone until a database change.
      throw AppError.conflict('Anda tidak dapat menurunkan peran akun Anda sendiri.');
    }

    const user = await this.repository.findUserById(input.userId);
    if (!user) throw AppError.notFound('Pengguna tidak ditemukan.');

    const updated = await this.repository.updateUserRole(input.userId, input.body.role);
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * A manual credit adjustment.
   *
   * Routed through the ledger (`ADJUSTMENT`) so the wallet invariant and the audit trail hold,
   * and a negative adjustment can never push a balance below zero.
   */
  async adjustCredits(input: { userId: string; adminUserId: string; body: CreditAdjustmentInput }) {
    const user = await this.repository.findUserById(input.userId);
    if (!user) throw AppError.notFound('Pengguna tidak ditemukan.');

    const transaction = await this.credits.adjust({
      userId: input.userId,
      amount: input.body.amount,
      reason: `Penyesuaian admin: ${input.body.reason}`,
      adminUserId: input.adminUserId,
    });

    const wallet = await this.credits.getWallet(input.userId);

    return { transaction, wallet };
  }
}

export const adminService = new AdminService();
