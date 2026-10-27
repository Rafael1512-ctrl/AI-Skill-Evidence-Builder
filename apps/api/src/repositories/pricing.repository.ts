import type { FeaturePricing } from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';

export class PricingRepository {
  async findAll(): Promise<FeaturePricing[]> {
    return getPrisma().featurePricing.findMany();
  }

  async findByFeature(feature: string): Promise<FeaturePricing | null> {
    return getPrisma().featurePricing.findUnique({ where: { feature } });
  }

  async upsert(feature: string, credits: number, updatedByUserId: string | null): Promise<FeaturePricing> {
    return getPrisma().featurePricing.upsert({
      where: { feature },
      update: { credits, updatedByUserId },
      create: { feature, credits, updatedByUserId },
    });
  }
}
