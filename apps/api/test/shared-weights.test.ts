import { describe, expect, it } from 'vitest';

import { normaliseWeights, validateCategoryWeights } from '@aseb/shared';

/**
 * Shared weight helpers (Phase 20).
 *
 * Pure and offline. These two functions are exported from `@aseb/shared` but nothing in the
 * app calls them today: the scoring engine normalises with its own (tested) rule set and the
 * recruiter contract validates category weights in `categoryWeightsSchema`. They are covered
 * here because they are public API with documented semantics, and because leaving exported
 * behaviour entirely untested is how a future refactor picks the wrong one (see
 * `PROJECT_CONTEXT.md` §8.44).
 */

describe('validateCategoryWeights', () => {
  it('accepts an empty or absent configuration as "nothing to validate"', () => {
    expect(validateCategoryWeights(null)).toEqual({ valid: true, issues: [], total: 0 });
    expect(validateCategoryWeights(undefined).valid).toBe(true);
    expect(validateCategoryWeights({}).valid).toBe(true);
  });

  it('accepts a complete configuration that totals exactly 100', () => {
    const result = validateCategoryWeights({
      EXPERIENCE: 30,
      TECHNICAL_SKILLS: 40,
      PROJECTS: 10,
      EDUCATION: 10,
      PORTFOLIO: 5,
      OTHER: 5,
    });

    expect(result).toEqual({ valid: true, issues: [], total: 100 });
  });

  it('rejects a total that is not 100 rather than silently renormalising it', () => {
    const result = validateCategoryWeights({ EXPERIENCE: 60, TECHNICAL_SKILLS: 30 });

    expect(result.valid).toBe(false);
    expect(result.total).toBe(90);
    expect(result.issues.map((issue) => issue.code)).toEqual(['CATEGORY_TOTAL_NOT_100']);
  });

  it('reports unknown categories, negatives and non-numbers', () => {
    const result = validateCategoryWeights({
      EXPERIENCE: -5,
      TECHNICAL_SKILLS: Number.NaN,
      MAGIC: 10,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code).sort()).toEqual([
      'NEGATIVE_WEIGHT',
      'NEGATIVE_WEIGHT',
      'UNKNOWN_CATEGORY',
    ]);
    // An unknown category cannot contribute to the total it is compared against.
    expect(result.total).toBe(0);
  });
});

describe('normaliseWeights', () => {
  it('turns weights into shares that sum to one', () => {
    const shares = normaliseWeights([{ weight: 30 }, { weight: 10 }]);

    expect(shares).toEqual([0.75, 0.25]);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
  });

  it('falls back to uniform shares for missing, zero or negative weights', () => {
    expect(normaliseWeights([{ weight: 0 }, { weight: 0 }])).toEqual([0.5, 0.5]);
    expect(normaliseWeights([{ weight: -3 }, { weight: Number.NaN }])).toEqual([0.5, 0.5]);
  });

  it('handles an empty list without dividing by zero', () => {
    expect(normaliseWeights([])).toEqual([]);
  });
});
