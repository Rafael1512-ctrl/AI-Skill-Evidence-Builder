import type { FeatureKey } from '@aseb/shared';

import { getPrisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import type { AiCallResult } from '../providers/ai/types.js';

export interface RecordAiUsageInput {
  userId: string | null;
  feature: FeatureKey;
  result: AiCallResult<unknown>;
  creditsCharged?: number;
  screeningJobId?: string | null;
  screeningCandidateId?: string | null;
  cvEnhancementId?: string | null;
  success?: boolean;
}

/**
 * Internal provider-cost accounting.
 *
 * This is deliberately separate from user-facing credit pricing: it exists for margin
 * analysis, monitoring and future repricing, and is never shown to end users.
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  try {
    await getPrisma().aiUsageRecord.create({
      data: {
        userId: input.userId,
        feature: input.feature,
        provider: input.result.provider,
        model: input.result.model,
        promptVersion: input.result.promptVersion,
        requestCount: input.result.usage.requestCount,
        inputTokens: input.result.usage.inputTokens,
        outputTokens: input.result.usage.outputTokens,
        cachedTokens: input.result.usage.cachedTokens,
        estimatedCostUsd: input.result.usage.estimatedCostUsd,
        targetRevenueUsd: input.result.usage.targetRevenueUsd,
        creditsCharged: input.creditsCharged ?? 0,
        screeningJobId: input.screeningJobId ?? null,
        screeningCandidateId: input.screeningCandidateId ?? null,
        cvEnhancementId: input.cvEnhancementId ?? null,
        latencyMs: input.result.latencyMs,
        success: input.success ?? true,
      },
    });
  } catch (error) {
    // Usage accounting must never break a user-facing workflow.
    logger.warn({ err: error, feature: input.feature }, 'Failed to record AI usage');
  }
}

export interface AiUsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number;
  targetRevenueUsd: number;
  creditsCharged: number;
}

export async function summariseAiUsageSince(since: Date): Promise<AiUsageSummary> {
  const rows = await getPrisma().aiUsageRecord.findMany({
    where: { createdAt: { gte: since } },
    select: {
      requestCount: true,
      inputTokens: true,
      outputTokens: true,
      cachedTokens: true,
      estimatedCostUsd: true,
      targetRevenueUsd: true,
      creditsCharged: true,
    },
  });

  return rows.reduce<AiUsageSummary>(
    (accumulator, row) => ({
      requests: accumulator.requests + row.requestCount,
      inputTokens: accumulator.inputTokens + row.inputTokens,
      outputTokens: accumulator.outputTokens + row.outputTokens,
      cachedTokens: accumulator.cachedTokens + row.cachedTokens,
      estimatedCostUsd: accumulator.estimatedCostUsd + Number(row.estimatedCostUsd ?? 0),
      targetRevenueUsd: accumulator.targetRevenueUsd + Number(row.targetRevenueUsd ?? 0),
      creditsCharged: accumulator.creditsCharged + row.creditsCharged,
    }),
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      estimatedCostUsd: 0,
      targetRevenueUsd: 0,
      creditsCharged: 0,
    },
  );
}

export async function summariseAiUsageByFeatureSince(
  since: Date,
): Promise<Array<{ feature: string; requests: number; estimatedCostUsd: number }>> {
  const rows = await getPrisma().aiUsageRecord.groupBy({
    by: ['feature'],
    where: { createdAt: { gte: since } },
    _sum: { requestCount: true, estimatedCostUsd: true },
  });

  return rows
    .map((row) => ({
      feature: row.feature,
      requests: row._sum.requestCount ?? 0,
      estimatedCostUsd: Number(row._sum.estimatedCostUsd ?? 0),
    }))
    .sort((left, right) => right.estimatedCostUsd - left.estimatedCostUsd);
}

export async function listAiUsage(input: {
  skip: number;
  take: number;
  feature?: string | undefined;
}) {
  const prisma = getPrisma();
  const where = input.feature ? { feature: input.feature } : {};
  const [items, total] = await Promise.all([
    prisma.aiUsageRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: input.skip,
      take: input.take,
    }),
    prisma.aiUsageRecord.count({ where }),
  ]);
  return { items, total };
}
