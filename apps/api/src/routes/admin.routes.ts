import { Router } from 'express';
import {
  adminUserListQuerySchema,
  aiUsageSummaryQuerySchema,
  creditAdjustmentSchema,
  featurePricingUpdateSchema,
  paginationQuerySchema,
  shortTextSchema,
  userRoleUpdateSchema,
} from '@aseb/shared';
import { z } from 'zod';

import {
  adjustAdminUserCredits,
  getAdminOverview,
  listAdminAiUsage,
  listAdminFailedCandidates,
  listAdminJobs,
  listAdminPayments,
  listAdminTransactions,
  listAdminUsers,
  listAdminWebhookEvents,
  updateAdminPricing,
  updateAdminUserRole,
} from '../controllers/admin.controller.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const userIdParamSchema = z.object({ userId: shortTextSchema });
const featureParamSchema = z.object({ feature: shortTextSchema });

/**
 * Admin console.
 *
 * `requireAuth` + `requireAdmin` are mounted once on the router, so a new route cannot
 * accidentally ship unguarded, and the role is re-read from the database on every request
 * instead of being trusted from a token claim.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth(), requireAdmin());

adminRouter.get('/overview', getAdminOverview);
adminRouter.get('/users', validate({ query: adminUserListQuerySchema }), listAdminUsers);
adminRouter.get('/transactions', validate({ query: paginationQuerySchema }), listAdminTransactions);
adminRouter.get('/payments', validate({ query: paginationQuerySchema }), listAdminPayments);
adminRouter.get(
  '/webhook-events',
  validate({ query: paginationQuerySchema }),
  listAdminWebhookEvents,
);
adminRouter.get('/ai-usage', validate({ query: aiUsageSummaryQuerySchema }), listAdminAiUsage);
adminRouter.get('/jobs', validate({ query: paginationQuerySchema }), listAdminJobs);
adminRouter.get(
  '/failed-candidates',
  validate({ query: paginationQuerySchema }),
  listAdminFailedCandidates,
);

adminRouter.put(
  '/pricing/:feature',
  validate({ params: featureParamSchema, body: featurePricingUpdateSchema }),
  updateAdminPricing,
);
adminRouter.patch(
  '/users/:userId/role',
  validate({ params: userIdParamSchema, body: userRoleUpdateSchema }),
  updateAdminUserRole,
);
adminRouter.post(
  '/users/:userId/credits',
  validate({ params: userIdParamSchema, body: creditAdjustmentSchema }),
  adjustAdminUserCredits,
);
