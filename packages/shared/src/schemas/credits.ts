import { z } from 'zod';

import type { TopUpPackage } from '../constants/credit-pricing.js';
import { CREDIT_TRANSACTION_TYPES } from '../constants/workflow.js';

export const creditWalletSchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Total credits ever granted or charged. */
  balance: z.number().int(),
  /** Credits held by active reservations and not spendable right now. */
  reserved: z.number().int(),
  /** balance - reserved. Always >= 0. */
  available: z.number().int(),
  lifetimeCreditsIn: z.number().int().min(0),
  lifetimeCreditsSpent: z.number().int().min(0),
  updatedAt: z.string(),
});

export type CreditWallet = z.infer<typeof creditWalletSchema>;

export const creditTransactionSchema = z.object({
  id: z.string(),
  type: z.enum(CREDIT_TRANSACTION_TYPES),
  /** Signed credit delta as applied to the wallet balance. */
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  feature: z.string().nullable(),
  description: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: z.string(),
});

export type CreditTransaction = z.infer<typeof creditTransactionSchema>;

export const creditTransactionListSchema = z.object({
  items: z.array(creditTransactionSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type CreditTransactionList = z.infer<typeof creditTransactionListSchema>;

export const creditReservationSchema = z.object({
  id: z.string(),
  feature: z.string(),
  reservedCredits: z.number().int().min(0),
  settledCredits: z.number().int().min(0).nullable(),
  state: z.enum(['ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED']),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
});

export type CreditReservation = z.infer<typeof creditReservationSchema>;

export const featurePricingSchema = z.object({
  feature: z.string(),
  credits: z.number().int().min(0),
  label: z.string(),
  description: z.string(),
  /** True when the value comes from the database rather than the code default. */
  isOverride: z.boolean(),
  sortOrder: z.number().int(),
  updatedAt: z.string().nullable(),
});

export type FeaturePricing = z.infer<typeof featurePricingSchema>;

export const estimateCostSchema = z.object({
  feature: z.string().min(1),
  quantity: z.number().int().min(1).max(1000).default(1),
});

export type EstimateCostInput = z.infer<typeof estimateCostSchema>;

export const costEstimateSchema = z.object({
  feature: z.string(),
  quantity: z.number().int().min(1),
  unitCredits: z.number().int().min(0),
  totalCredits: z.number().int().min(0),
  balance: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  sufficient: z.boolean(),
  shortfall: z.number().int().min(0),
});

export type CostEstimate = z.infer<typeof costEstimateSchema>;

/* -------------------------------------------------------------------------- */
/* Responses consumed by the web client                                        */
/* -------------------------------------------------------------------------- */

/** `GET /api/credits/pricing` */
export const featurePricingListSchema = z.array(featurePricingSchema);

export type FeaturePricingList = z.infer<typeof featurePricingListSchema>;

/**
 * `GET /api/credits/packages`
 *
 * The packages themselves are a plain constant in `constants/credit-pricing.ts`.
 * Declaring the schema as `ZodType<TopUpPackage>` is deliberate: the compiler fails
 * here if the schema and that contract ever drift apart.
 */
export const topUpPackageSchema: z.ZodType<TopUpPackage> = z.object({
  id: z.string(),
  credits: z.number().int().positive(),
  priceIdr: z.number().int().positive(),
  label: z.string(),
  highlight: z.boolean(),
});

export const topUpPackageListSchema = z.array(topUpPackageSchema);

export type TopUpPackageList = z.infer<typeof topUpPackageListSchema>;
