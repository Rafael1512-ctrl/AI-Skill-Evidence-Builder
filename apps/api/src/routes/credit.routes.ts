import { Router } from 'express';
import { estimateCostSchema, paginationQuerySchema } from '@aseb/shared';

import {
  estimateCost,
  getWallet,
  listPackages,
  listPricing,
  listTransactions,
} from '../controllers/credit.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const creditRouter = Router();

creditRouter.get('/pricing', listPricing);
creditRouter.get('/packages', listPackages);

creditRouter.get('/wallet', requireAuth(), getWallet);
creditRouter.get('/transactions', requireAuth(), validate({ query: paginationQuerySchema }), listTransactions);
creditRouter.post('/estimate', requireAuth(), validate({ body: estimateCostSchema }), estimateCost);
