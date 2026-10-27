import { describe, expect, it } from 'vitest';

import type {
  CriterionEvidence,
  EvidenceStatus,
  RequirementClass,
  ScoringCategory,
} from '@aseb/shared';

import { CRITERION_OUTCOME_POINTS, scoreCandidate } from '../src/services/scoring/engine.js';
import type { ScoringRequirement } from '../src/services/scoring/engine.js';

/**
 * Deterministic scoring. Pure and offline: no database, no provider, no clock.
 *
 * These pin the rule set the product promises - the AI never scores, an uncorroborated
 * verdict can only lose credit, and a hard requirement never removes a candidate from the
 * results.
 */

function requirement(overrides: Partial<ScoringRequirement> = {}): ScoringRequirement {
  return {
    requirementId: 'req-1',
    text: 'Pengalaman minimal 3 tahun dengan Node.js',
    category: 'TECHNICAL_SKILLS' as ScoringCategory,
    requirementClass: 'REQUIRED' as RequirementClass,
    weight: 10,
    hardRequirement: false,
    ...overrides,
  };
}

function verdict(
  requirementId: string,
  status: EvidenceStatus,
  overrides: Partial<CriterionEvidence> = {},
): CriterionEvidence {
  return {
    requirementId,
    status,
    confidence: status === 'FOUND' ? 0.9 : 0.3,
    evidence:
      status === 'FOUND'
        ? [
            {
              quote: 'lima tahun pengalaman Node.js',
              source: 'CV',
              page: null,
              url: null,
              note: null,
            },
          ]
        : [],
    notes: '',
    ...overrides,
  };
}

function score(
  requirements: readonly ScoringRequirement[],
  criteria: readonly CriterionEvidence[],
  categoryWeights?: Record<string, number> | null,
) {
  return scoreCandidate({ requirements, evidence: { criteria }, categoryWeights });
}

describe('deterministic scoring engine', () => {
  it('gives every requirement an equal share when no category weights are set', () => {
    const result = score(
      [
        requirement({ requirementId: 'a' }),
        requirement({ requirementId: 'b' }),
        requirement({ requirementId: 'c' }),
        requirement({ requirementId: 'd' }),
      ],
      [
        verdict('a', 'FOUND'),
        verdict('b', 'FOUND'),
        verdict('c', 'NOT_FOUND'),
        verdict('d', 'NOT_FOUND'),
      ],
    );

    expect(result.criteria.map((criterion) => criterion.normalisedWeight)).toEqual([
      0.25, 0.25, 0.25, 0.25,
    ]);
    expect(result.score).toBe(50);
  });

  it('scores a fully supported candidate 100 and a fully unsupported one 0', () => {
    const supported = score([requirement()], [verdict('req-1', 'FOUND')]);
    const unsupported = score([requirement()], [verdict('req-1', 'NOT_FOUND')]);

    expect(supported.score).toBe(100);
    expect(supported.eligibilityStatus).toBe('HIGH_MATCH');
    expect(unsupported.score).toBe(0);
    expect(unsupported.eligibilityStatus).toBe('LOW_MATCH');
  });

  it('lets category weights redistribute influence', () => {
    const requirements = [
      requirement({ requirementId: 'tech', category: 'TECHNICAL_SKILLS', weight: 10 }),
      requirement({ requirementId: 'exp', category: 'EXPERIENCE', weight: 10 }),
    ];
    const criteria = [verdict('tech', 'NOT_FOUND'), verdict('exp', 'FOUND')];

    const balanced = score(requirements, criteria, { TECHNICAL_SKILLS: 50, EXPERIENCE: 50 });
    const experienceHeavy = score(requirements, criteria, { TECHNICAL_SKILLS: 10, EXPERIENCE: 90 });

    expect(balanced.score).toBe(50);
    expect(experienceHeavy.score).toBe(90);
    // Mixed evaluation still finds the criterion that matters.
    expect(experienceHeavy.criteria.find((c) => c.requirementId === 'tech')?.normalisedWeight).toBe(
      0.1,
    );
  });

  it('gives half credit for an UNCERTAIN criterion and none for NOT_FOUND', () => {
    const result = score(
      [requirement({ requirementId: 'a' }), requirement({ requirementId: 'b' })],
      [verdict('a', 'UNCERTAIN'), verdict('b', 'NOT_FOUND')],
    );

    expect(result.criteria.map((criterion) => criterion.earnedScore)).toEqual([
      CRITERION_OUTCOME_POINTS.UNCERTAIN,
      CRITERION_OUTCOME_POINTS.NOT_FOUND,
    ]);
    expect(result.score).toBe(25);
  });

  it('downgrades a FOUND verdict below the confidence threshold', () => {
    const result = score([requirement()], [verdict('req-1', 'FOUND', { confidence: 0.2 })]);
    const [criterion] = result.criteria;

    expect(criterion?.status).toBe('UNCERTAIN');
    expect(criterion?.reportedStatus).toBe('FOUND');
    expect(criterion?.confidenceDowngraded).toBe(true);
    expect(criterion?.earnedScore).toBe(50);
    expect(criterion?.confidence).toBe(0.2);
    expect(criterion?.notes).toContain('diturunkan menjadi UNCERTAIN');
    expect(result.score).toBe(50);
  });

  it('keeps FOUND at the threshold and above, and never upgrades a verdict', () => {
    const atThreshold = score([requirement()], [verdict('req-1', 'FOUND', { confidence: 0.45 })]);
    const uncertain = score([requirement()], [verdict('req-1', 'UNCERTAIN', { confidence: 1 })]);
    const notFound = score([requirement()], [verdict('req-1', 'NOT_FOUND', { confidence: 1 })]);

    expect(atThreshold.criteria[0]?.status).toBe('FOUND');
    expect(atThreshold.score).toBe(100);
    expect(uncertain.criteria[0]?.status).toBe('UNCERTAIN');
    expect(notFound.criteria[0]?.status).toBe('NOT_FOUND');
  });

  it('cannot keep FOUND without a stored quote', () => {
    const result = score([requirement()], [verdict('req-1', 'FOUND', { evidence: [] })]);

    expect(result.criteria[0]?.status).toBe('UNCERTAIN');
    expect(result.criteria[0]?.confidenceDowngraded).toBe(true);
  });

  it('treats a missing verdict as absent evidence and says so', () => {
    const result = score([requirement()], []);
    const [criterion] = result.criteria;

    expect(criterion?.missingVerdict).toBe(true);
    expect(criterion?.status).toBe('NOT_FOUND');
    expect(criterion?.earnedScore).toBe(0);
    expect(criterion?.notes).toContain('tidak memberikan putusan');
    expect(result.gaps).toEqual(['Pengalaman minimal 3 tahun dengan Node.js']);
  });

  it('flags an unmet hard requirement without hiding the candidate', () => {
    const result = score(
      [
        requirement({ requirementId: 'hard', text: 'Wajib punya SIM A', hardRequirement: true }),
        requirement({ requirementId: 'soft', text: 'Suka menulis dokumentasi', weight: 20 }),
      ],
      [verdict('hard', 'NOT_FOUND'), verdict('soft', 'FOUND')],
    );

    expect(result.eligibilityStatus).toBe('REQUIREMENT_NOT_MET');
    expect(result.unmetHardRequirements).toEqual(['Wajib punya SIM A']);
    // The candidate is still scored and still reported.
    expect(result.score).toBeGreaterThan(0);
    expect(result.criteria).toHaveLength(2);
  });

  it('applies the shared eligibility thresholds', () => {
    const twoRequirements = [
      requirement({ requirementId: 'a', weight: 55 }),
      requirement({ requirementId: 'b', weight: 45 }),
    ];

    const consider = score(twoRequirements, [verdict('a', 'FOUND'), verdict('b', 'NOT_FOUND')]);
    const low = score(
      [
        requirement({ requirementId: 'a', weight: 54 }),
        requirement({ requirementId: 'b', weight: 46 }),
      ],
      [verdict('a', 'FOUND'), verdict('b', 'NOT_FOUND')],
    );
    const high = score(
      [
        requirement({ requirementId: 'a', weight: 75 }),
        requirement({ requirementId: 'b', weight: 25 }),
      ],
      [verdict('a', 'FOUND'), verdict('b', 'NOT_FOUND')],
    );

    expect(consider.score).toBe(55);
    expect(consider.eligibilityStatus).toBe('CONSIDER');
    expect(low.score).toBe(54);
    expect(low.eligibilityStatus).toBe('LOW_MATCH');
    expect(high.score).toBe(75);
    expect(high.eligibilityStatus).toBe('HIGH_MATCH');
  });

  it('derives strengths, gaps and uncertainties from the criterion results', () => {
    const result = score(
      [
        requirement({ requirementId: 'a', text: 'Node.js' }),
        requirement({ requirementId: 'b', text: 'Kubernetes' }),
        requirement({ requirementId: 'c', text: 'Kepemimpinan' }),
      ],
      [verdict('a', 'FOUND'), verdict('b', 'NOT_FOUND'), verdict('c', 'UNCERTAIN')],
    );

    expect(result.strengths).toEqual(['Node.js']);
    expect(result.gaps).toEqual(['Kubernetes']);
    expect(result.uncertainties).toEqual(['Kepemimpinan']);
  });

  it('stores values that reproduce the score, with weight fractions of one', () => {
    const result = score(
      [
        requirement({ requirementId: 'a', weight: 3 }),
        requirement({ requirementId: 'b', weight: 7 }),
      ],
      [verdict('a', 'FOUND'), verdict('b', 'UNCERTAIN')],
    );

    const reproduced = result.criteria.reduce(
      (total, criterion) => total + criterion.earnedScore * criterion.normalisedWeight,
      0,
    );
    const storedTotal = result.criteria.reduce(
      (total, criterion) => total + criterion.normalisedWeight,
      0,
    );

    expect(result.rawScore).toBeCloseTo(reproduced, 2);
    expect(result.score).toBe(Math.round(reproduced));
    expect(storedTotal).toBeCloseTo(1, 5);
    for (const criterion of result.criteria) {
      // Decimal(6,5) and Decimal(5,2) cannot hold more precision than this.
      expect(String(criterion.normalisedWeight).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
      expect(Number.isInteger(criterion.earnedScore)).toBe(true);
    }
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('is deterministic and independent of evidence order', () => {
    const requirements = [
      requirement({ requirementId: 'a' }),
      requirement({ requirementId: 'b' }),
      requirement({ requirementId: 'c' }),
    ];
    const criteria = [verdict('a', 'FOUND'), verdict('b', 'NOT_FOUND'), verdict('c', 'UNCERTAIN')];

    const first = score(requirements, criteria);
    const second = score(requirements, criteria);
    const reversed = score(requirements, [...criteria].reverse());

    expect(second).toEqual(first);
    expect(reversed.score).toBe(first.score);
    expect(reversed.criteria).toEqual(first.criteria);
  });

  it('handles degenerate input without inventing a score', () => {
    const empty = score([], []);
    const zeroWeights = score([requirement({ weight: 0 })], [verdict('req-1', 'FOUND')], {
      TECHNICAL_SKILLS: 0,
    });

    expect(empty.score).toBe(0);
    expect(empty.eligibilityStatus).toBe('LOW_MATCH');
    expect(empty.strengths).toEqual([]);
    expect(zeroWeights.criteria[0]?.normalisedWeight).toBe(0);
    expect(zeroWeights.score).toBe(0);
  });
});
