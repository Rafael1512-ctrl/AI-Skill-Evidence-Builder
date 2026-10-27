import type { Request, Response } from 'express';

import type {
  AdminUserListQuery,
  AiUsageSummaryQuery,
  CreditAdjustmentInput,
  FeaturePricingUpdateInput,
  PaginationQuery,
  UserRoleUpdateInput,
} from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.js';
import { adminService } from '../services/admin.service.js';

/**
 * Admin console API.
 *
 * Every handler assumes `requireAdmin` already ran (the router mounts it once) and never
 * trusts a client-supplied role. Reports are read-only; the two mutations are role changes
 * and ledger-routed credit adjustments.
 */

/** GET /api/admin/overview - the dashboard: users, money, AI cost, screening, system. */
export async function getAdminOverview(_req: Request, res: Response): Promise<void> {
  const overview = await adminService.overview();
  const pricing = await adminService.listPricing();

  res.json({ data: { overview, pricing } });
}

/** GET /api/admin/users - paginated users with their wallet balances. */
export async function listAdminUsers(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<AdminUserListQuery>(req);
  const users = await adminService.listUsers(query);

  res.json({
    data: { users },
    meta: { page: users.page, pageSize: users.pageSize, total: users.total },
  });
}

/** GET /api/admin/transactions - the system-wide ledger. */
export async function listAdminTransactions(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery>(req);
  const transactions = await adminService.listTransactions(query);

  res.json({
    data: { transactions },
    meta: { page: transactions.page, pageSize: transactions.pageSize, total: transactions.total },
  });
}

/** GET /api/admin/payments - every payment attempt. */
export async function listAdminPayments(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery>(req);
  const payments = await adminService.listPayments(query);

  res.json({
    data: { payments },
    meta: { page: payments.page, pageSize: payments.pageSize, total: payments.total },
  });
}

/** GET /api/admin/webhook-events - deliveries, including the rejected ones. */
export async function listAdminWebhookEvents(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery>(req);
  const events = await adminService.listWebhookEvents(query);

  res.json({
    data: { events },
    meta: { page: events.page, pageSize: events.pageSize, total: events.total },
  });
}

/** GET /api/admin/ai-usage - provider cost and margin analysis (never user-facing). */
export async function listAdminAiUsage(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<AiUsageSummaryQuery>(req);
  const usage = await adminService.listAiUsage(query);

  res.json({
    data: { usage },
    meta: { page: usage.page, pageSize: usage.pageSize, total: usage.total },
  });
}

/** GET /api/admin/jobs - all screening jobs with their owner. */
export async function listAdminJobs(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery>(req);
  const jobs = await adminService.listJobs(query);

  res.json({
    data: { jobs },
    meta: { page: jobs.page, pageSize: jobs.pageSize, total: jobs.total },
  });
}

/** GET /api/admin/failed-candidates - the failed-job view. */
export async function listAdminFailedCandidates(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PaginationQuery>(req);
  const failed = await adminService.listFailedCandidates(query);

  res.json({
    data: { failed },
    meta: { page: failed.page, pageSize: failed.pageSize, total: failed.total },
  });
}

/** PUT /api/admin/pricing/:feature - set a credit-price override. */
export async function updateAdminPricing(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { feature } = validatedParams<{ feature: string }>(req);
  const body = validatedBody<FeaturePricingUpdateInput>(req);

  const pricing = await adminService.updatePricing({
    feature,
    credits: body.credits,
    adminUserId: auth.userId,
  });

  res.json({ data: { pricing } });
}

/** PATCH /api/admin/users/:userId/role - grant or revoke the admin role. */
export async function updateAdminUserRole(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { userId } = validatedParams<{ userId: string }>(req);
  const body = validatedBody<UserRoleUpdateInput>(req);

  const user = await adminService.updateUserRole({
    userId,
    adminUserId: auth.userId,
    body,
  });

  res.json({ data: { user } });
}

/** POST /api/admin/users/:userId/credits - ledger-routed credit adjustment. */
export async function adjustAdminUserCredits(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { userId } = validatedParams<{ userId: string }>(req);
  const body = validatedBody<CreditAdjustmentInput>(req);

  const result = await adminService.adjustCredits({
    userId,
    adminUserId: auth.userId,
    body,
  });

  // The service already returns the shared ledger DTO, so the console gets the same shape
  // the user-facing ledger uses.
  res.status(201).json({ data: result });
}
