import { Router } from 'express';
import { paginationQuerySchema, topUpRequestSchema } from '@aseb/shared';
import { z } from 'zod';

import { env } from '../config/env.js';
import {
  createCheckout,
  getPayment,
  listPayments,
  midtransWebhook,
  mockWebhook,
  simulateMockPayment,
} from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

export const paymentRouter = Router();

const paymentParamsSchema = z.object({ paymentId: z.string().min(1).max(64) });

/** Provider callbacks are unauthenticated by design: the signature is the credential. */
const webhookRateLimit = rateLimit({
  scope: 'payment-webhook',
  windowMs: 60_000,
  max: env.API_RATE_LIMIT_PER_MINUTE,
  message: 'Terlalu banyak notifikasi pembayaran. Silakan coba lagi sebentar lagi.',
});

paymentRouter.post('/webhook/mock', webhookRateLimit, mockWebhook);
paymentRouter.post('/webhook/midtrans', webhookRateLimit, midtransWebhook);

/** Top-up for the signed-in user. */
paymentRouter.post(
  '/checkout',
  requireAuth(),
  validate({ body: topUpRequestSchema }),
  createCheckout,
);
paymentRouter.get('/', requireAuth(), validate({ query: paginationQuerySchema }), listPayments);
paymentRouter.get(
  '/:paymentId',
  requireAuth(),
  validate({ params: paymentParamsSchema }),
  getPayment,
);
paymentRouter.post(
  '/:paymentId/simulate',
  requireAuth(),
  validate({ params: paymentParamsSchema }),
  simulateMockPayment,
);
