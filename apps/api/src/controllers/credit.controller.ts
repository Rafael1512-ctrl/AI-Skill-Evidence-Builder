import type { Request, Response } from 'express';

import { TOPUP_PACKAGES, type EstimateCostInput, type PaginationQuery } from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody, validatedQuery } from '../middleware/validate.js';
import { assertFeatureKey, pricingService } from '../services/pricing.service.js';
import { creditService } from '../services/credit.service.js';

/** GET /api/credits/wallet */
export async function getWallet(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const wallet = await creditService.getWallet(auth.userId);
  res.json({ data: wallet });
}

/** GET /api/credits/transactions - the user-visible ledger history. */
export async function listTransactions(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const query = validatedQuery<PaginationQuery>(req);

  const result = await creditService.listTransactions({
    userId: auth.userId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({ data: result, meta: { page: result.page, pageSize: result.pageSize, total: result.total } });
}

/** POST /api/credits/estimate - preflight cost check before an expensive operation. */
export async function estimateCost(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const body = validatedBody<EstimateCostInput>(req);
  const feature = assertFeatureKey(body.feature);

  const estimate = await creditService.estimate(auth.userId, feature, body.quantity);
  res.json({ data: estimate });
}

/** GET /api/credits/pricing - the public price list (credits, never rupiah per AI call). */
export async function listPricing(_req: Request, res: Response): Promise<void> {
  const pricing = await pricingService.listAll();
  res.json({ data: pricing });
}

/** GET /api/credits/packages - top-up options. */
export function listPackages(_req: Request, res: Response): void {
  res.json({ data: TOPUP_PACKAGES });
}
