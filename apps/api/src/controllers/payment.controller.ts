import type { Request, Response } from 'express';

import type { PaginationQuery, TopUpRequest } from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody, validatedParams, validatedQuery } from '../middleware/validate.js';
import { paymentService } from '../services/payment.service.js';

/** POST /api/payments/checkout - starts a top-up attempt for the signed-in user. */
export async function createCheckout(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const body = validatedBody<TopUpRequest>(req);

  const payment = await paymentService.checkout({
    userId: auth.userId,
    ...(body.packageId !== undefined ? { packageId: body.packageId } : {}),
    ...(body.credits !== undefined ? { credits: body.credits } : {}),
  });

  res.status(201).json({ data: { payment } });
}

/** GET /api/payments - the signed-in user's own top-up attempts. */
export async function listPayments(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const query = validatedQuery<PaginationQuery>(req);

  const result = await paymentService.listForUser({
    userId: auth.userId,
    page: query.page,
    pageSize: query.pageSize,
  });

  res.json({
    data: result,
    meta: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

/** GET /api/payments/:paymentId */
export async function getPayment(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { paymentId } = validatedParams<{ paymentId: string }>(req);

  const payment = await paymentService.getForUser(auth.userId, paymentId);
  res.json({ data: { payment } });
}

/**
 * Development-only settlement of an offline payment.
 *
 * The signature is produced server-side and the request goes through the same webhook
 * verification path a gateway would use; the browser never asserts success.
 */
export async function simulateMockPayment(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const { paymentId } = validatedParams<{ paymentId: string }>(req);

  const payment = await paymentService.simulateMockPayment(auth.userId, paymentId);
  res.json({ data: { payment } });
}

/** POST /api/payments/webhook/mock - public; the signature is the authentication. */
export async function mockWebhook(req: Request, res: Response): Promise<void> {
  const result = await paymentService.handleWebhook('mock', {
    headers: req.headers,
    body: req.body,
  });

  res.json({
    data: { status: result.status, reason: result.reason, payment: result.payment },
  });
}

/** POST /api/payments/webhook/midtrans - public; the signature is the authentication. */
export async function midtransWebhook(req: Request, res: Response): Promise<void> {
  const result = await paymentService.handleWebhook('midtrans', {
    headers: req.headers,
    body: req.body,
  });

  res.json({
    data: { status: result.status, reason: result.reason, payment: result.payment },
  });
}
