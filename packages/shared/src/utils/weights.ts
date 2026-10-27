import type { ScoringCategory } from '../constants/workflow.js';
import { SCORING_CATEGORIES } from '../constants/workflow.js';

export interface WeightValidationIssue {
  code: 'NEGATIVE_WEIGHT' | 'ZERO_WEIGHT' | 'CATEGORY_TOTAL_NOT_100' | 'UNKNOWN_CATEGORY';
  message: string;
}

export interface WeightValidationResult {
  valid: boolean;
  issues: WeightValidationIssue[];
  total: number;
}

/**
 * Category weights are optional, but when present they must cover known categories
 * and total exactly 100. Partial or over-total configurations are rejected instead of
 * being silently renormalised, so a recruiter always knows what they configured.
 */
export function validateCategoryWeights(
  weights: Record<string, number> | null | undefined,
): WeightValidationResult {
  const issues: WeightValidationIssue[] = [];
  if (!weights || Object.keys(weights).length === 0) {
    return { valid: true, issues, total: 0 };
  }

  let total = 0;
  for (const [category, value] of Object.entries(weights)) {
    if (!SCORING_CATEGORIES.includes(category as ScoringCategory)) {
      issues.push({
        code: 'UNKNOWN_CATEGORY',
        message: `Kategori "${category}" tidak dikenal.`,
      });
      continue;
    }
    if (!Number.isFinite(value)) {
      issues.push({ code: 'NEGATIVE_WEIGHT', message: `Bobot "${category}" bukan angka.` });
      continue;
    }
    if (value < 0) {
      issues.push({ code: 'NEGATIVE_WEIGHT', message: `Bobot "${category}" tidak boleh negatif.` });
      continue;
    }
    total += value;
  }

  if (issues.length === 0 && Math.abs(total - 100) > 0.001) {
    issues.push({
      code: 'CATEGORY_TOTAL_NOT_100',
      message: `Total bobot kategori harus tepat 100. Saat ini ${total}.`,
    });
  }

  return { valid: issues.length === 0, issues, total };
}

/**
 * Normalises criterion weights into a 0..1 share. When every criterion in a group has
 * the same weight the share is uniform, which keeps unconfigured jobs predictable.
 */
export function normaliseWeights<T extends { weight: number }>(items: readonly T[]): number[] {
  if (items.length === 0) return [];
  const sanitised = items.map((item) => (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1));
  const total = sanitised.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return items.map(() => 1 / items.length);
  }
  return sanitised.map((value) => value / total);
}
