import { z } from 'zod';

import { FEATURE_KEYS, MAX_FEATURE_CREDIT_COST } from '../constants/credit-pricing.js';
import { PAYMENT_STATUSES, SCREENING_JOB_STATES } from '../constants/workflow.js';
import { USER_ROLES } from '../constants/roles.js';
import { creditTransactionSchema, featurePricingSchema } from './credits.js';
import { paginationQuerySchema } from './common.js';

export const featurePricingUpdateSchema = z.object({
  credits: z.number().int().min(0).max(MAX_FEATURE_CREDIT_COST),
});

export type FeaturePricingUpdateInput = z.infer<typeof featurePricingUpdateSchema>;

export const userRoleUpdateSchema = z.object({
  role: z.enum(USER_ROLES),
});

export type UserRoleUpdateInput = z.infer<typeof userRoleUpdateSchema>;

export const creditAdjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, {
      message: 'Jumlah penyesuaian tidak boleh nol.',
    }),
  reason: z.string().trim().min(5).max(240),
});

export type CreditAdjustmentInput = z.infer<typeof creditAdjustmentSchema>;

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
});

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminOverviewSchema = z.object({
  users: z.object({
    total: z.number().int().min(0),
    newLast7Days: z.number().int().min(0),
    admins: z.number().int().min(0),
  }),
  credits: z.object({
    outstanding: z.number().int(),
    reserved: z.number().int(),
    creditsInLast30Days: z.number().int(),
    creditsSpentLast30Days: z.number().int(),
  }),
  revenue: z.object({
    paidIdrLast30Days: z.number().int().min(0),
    pendingIdr: z.number().int().min(0),
    paidTransactionsLast30Days: z.number().int().min(0),
  }),
  ai: z.object({
    requestsLast30Days: z.number().int().min(0),
    estimatedCostUsdLast30Days: z.number().min(0),
    /** Provider cost multiplied by AI_MARKUP_MULTIPLIER, for margin analysis. */
    targetRevenueUsdLast30Days: z.number().min(0),
    tokensLast30Days: z.object({
      input: z.number().int().min(0),
      output: z.number().int().min(0),
      cached: z.number().int().min(0),
    }),
    byFeature: z.array(
      z.object({
        feature: z.string(),
        requests: z.number().int().min(0),
        estimatedCostUsd: z.number().min(0),
      }),
    ),
  }),
  screening: z.object({
    totalJobs: z.number().int().min(0),
    activeJobs: z.number().int().min(0),
    failedCandidates: z.number().int().min(0),
    totalCandidates: z.number().int().min(0),
    failureRate: z.number().min(0).max(1),
  }),
  testimonials: z.object({
    pending: z.number().int().min(0),
    approved: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
  system: z.object({
    nodeVersion: z.string(),
    uptimeSeconds: z.number().min(0),
    database: z.enum(['connected', 'unavailable']),
    redis: z.enum(['connected', 'in-process']),
    aiProvider: z.string(),
    paymentProvider: z.string(),
    queueDriver: z.enum(['bullmq', 'in-process']),
    environment: z.string(),
  }),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const aiUsageSummaryQuerySchema = paginationQuerySchema.extend({
  feature: z.string().trim().max(64).optional(),
});

export type AiUsageSummaryQuery = z.infer<typeof aiUsageSummaryQuerySchema>;

const REPORT_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ADMIN_REPORT_MAX_MONTHS = 36;

export const adminReportMonthSchema = z
  .string()
  .trim()
  .regex(REPORT_MONTH_PATTERN, 'Gunakan format bulan YYYY-MM.');

function monthIndex(value: string): number {
  const [year = 0, month = 1] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

/**
 * Filters for the read-only admin reports.
 *
 * `from` and `to` are inclusive calendar months in Asia/Jakarta. When omitted the service
 * returns the current month and the previous five months. Keeping the range bounded prevents
 * an accidental all-history aggregate over the ledger and usage tables.
 */
export const adminReportQuerySchema = paginationQuerySchema
  .extend({
    from: adminReportMonthSchema.optional(),
    to: adminReportMonthSchema.optional(),
    feature: z.enum(FEATURE_KEYS).optional(),
    search: z.string().trim().max(120).optional(),
    sort: z.enum(['usage', 'purchases', 'balance']).default('usage'),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: 'Bulan awal tidak boleh setelah bulan akhir.',
    path: ['from'],
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      monthIndex(value.to) - monthIndex(value.from) + 1 <= ADMIN_REPORT_MAX_MONTHS,
    { message: `Rentang laporan maksimal ${ADMIN_REPORT_MAX_MONTHS} bulan.`, path: ['to'] },
  );

export type AdminReportQuery = z.infer<typeof adminReportQuerySchema>;

export const adminMonthlyRevenueReportSchema = z.object({
  month: adminReportMonthSchema,
  revenueIdr: z.number().int().min(0),
  payments: z.number().int().min(0),
  creditsSold: z.number().int().min(0),
});

export type AdminMonthlyRevenueReport = z.infer<typeof adminMonthlyRevenueReportSchema>;

export const adminMonthlyAiUsageReportSchema = z.object({
  month: adminReportMonthSchema,
  requests: z.number().int().min(0),
  failedRequests: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
  creditsCharged: z.number().int().min(0),
});

export type AdminMonthlyAiUsageReport = z.infer<typeof adminMonthlyAiUsageReportSchema>;

export const adminUserCreditReportSchema = z.object({
  userId: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(USER_ROLES),
  balance: z.number().int(),
  reserved: z.number().int(),
  creditsPurchased: z.number().int().min(0),
  purchaseCount: z.number().int().min(0),
  creditsUsed: z.number().int().min(0),
  usageCount: z.number().int().min(0),
});

export type AdminUserCreditReport = z.infer<typeof adminUserCreditReportSchema>;

export const adminReportSchema = z.object({
  range: z.object({
    from: adminReportMonthSchema,
    to: adminReportMonthSchema,
  }),
  summary: z.object({
    revenueIdr: z.number().int().min(0),
    payments: z.number().int().min(0),
    creditsPurchased: z.number().int().min(0),
    creditsUsed: z.number().int().min(0),
    aiRequests: z.number().int().min(0),
    aiEstimatedCostUsd: z.number().min(0),
    aiCreditsCharged: z.number().int().min(0),
  }),
  monthlyRevenue: z.array(adminMonthlyRevenueReportSchema),
  monthlyAiUsage: z.array(adminMonthlyAiUsageReportSchema),
  perUser: z.object({
    items: z.array(adminUserCreditReportSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  }),
});

export type AdminReport = z.infer<typeof adminReportSchema>;
export const adminReportResponseSchema = z.object({ report: adminReportSchema });

/* -------------------------------------------------------------------------- */
/* Console payloads (Phase 18)                                                 */
/* -------------------------------------------------------------------------- */

/** The dashboard in one call: the aggregates plus the current price list. */
export const adminOverviewResponseSchema = z.object({
  overview: adminOverviewSchema,
  pricing: z.array(featurePricingSchema),
});

export type AdminOverviewResponse = z.infer<typeof adminOverviewResponseSchema>;

export const adminUserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(USER_ROLES),
  isActive: z.boolean(),
  emailVerified: z.boolean(),
  balance: z.number().int(),
  reserved: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const adminUserListSchema = z.object({
  items: z.array(adminUserSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export const adminTransactionListSchema = z.object({
  // Same shape as the user-facing ledger, plus the owning user id.
  items: z.array(creditTransactionSchema.extend({ userId: z.string() })),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export const adminPaymentSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.string(),
  orderId: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  amountIdr: z.number().int().min(0),
  credits: z.number().int().min(0),
  failureReason: z.string().nullable(),
  paidAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const adminPaymentListSchema = z.object({
  items: z.array(adminPaymentSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

/** A webhook delivery, including the ones whose signature or processing failed. */
export const adminWebhookEventSchema = z.object({
  id: z.string(),
  provider: z.string(),
  eventType: z.string(),
  paymentTransactionId: z.string().nullable(),
  signatureValid: z.boolean(),
  processed: z.boolean(),
  errorMessage: z.string().nullable(),
  receivedAt: z.string(),
});

export const adminWebhookEventListSchema = z.object({
  items: z.array(adminWebhookEventSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

/** Provider cost accounting; never surfaced to end users. */
export const adminAiUsageSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  feature: z.string(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string().nullable(),
  requestCount: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0),
  estimatedCostUsd: z.number().nullable(),
  targetRevenueUsd: z.number().nullable(),
  creditsCharged: z.number().int().min(0),
  success: z.boolean(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string(),
});

export const adminAiUsageListSchema = z.object({
  items: z.array(adminAiUsageSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export const adminJobSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  ownerEmail: z.string(),
  title: z.string(),
  state: z.enum(SCREENING_JOB_STATES),
  totalCandidates: z.number().int().min(0),
  completedCandidates: z.number().int().min(0),
  failedCandidates: z.number().int().min(0),
  creditsCharged: z.number().int().min(0),
  createdAt: z.string(),
});

export const adminJobListSchema = z.object({
  items: z.array(adminJobSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

/** The failed-job view: which candidate failed, in which batch, and why. */
export const adminFailedCandidateSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobTitle: z.string(),
  userId: z.string(),
  candidateName: z.string(),
  fileName: z.string(),
  attempts: z.number().int().min(0),
  failureReason: z.string().nullable(),
  updatedAt: z.string(),
});

export const adminFailedCandidateListSchema = z.object({
  items: z.array(adminFailedCandidateSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export const adminCreditAdjustmentResponseSchema = z.object({
  transaction: creditTransactionSchema,
  wallet: z.object({
    id: z.string(),
    userId: z.string(),
    balance: z.number().int(),
    reserved: z.number().int(),
    available: z.number().int(),
    lifetimeCreditsIn: z.number().int(),
    lifetimeCreditsSpent: z.number().int(),
    updatedAt: z.string(),
  }),
});

export type AdminCreditAdjustmentResponse = z.infer<typeof adminCreditAdjustmentResponseSchema>;
