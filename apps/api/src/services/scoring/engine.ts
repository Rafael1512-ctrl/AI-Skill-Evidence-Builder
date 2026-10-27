import {
  ELIGIBILITY_THRESHOLDS,
  UNCERTAIN_CONFIDENCE_THRESHOLD,
  type CriterionEvidence,
  type EligibilityStatus,
  type EvidenceItem,
  type EvidenceStatus,
  type RequirementClass,
  type ScoringCategory,
} from '@aseb/shared';

/**
 * The deterministic scoring engine (Phase 14).
 *
 * Pure functions only: the same evidence always produces the same score, on any machine,
 * with no model call and no clock. The AI extracts evidence; this module decides the number
 * (docs/AI_PROMPTS.md §11, PROJECT_CONTEXT §9).
 *
 * The rule set, in words:
 *   1. An uncorroborated verdict counts for less. `FOUND` with a confidence below
 *      `UNCERTAIN_CONFIDENCE_THRESHOLD` (or with no stored quote at all) is treated as
 *      `UNCERTAIN`. A verdict can only ever be downgraded this way, never upgraded.
 *   2. Each criterion earns a fixed outcome: `FOUND` 100, `UNCERTAIN` 50, `NOT_FOUND` 0.
 *      Half credit for a genuinely ambiguous criterion is deliberate: it neither rewards nor
 *      punishes the candidate for evidence the material does not settle.
 *   3. Influence is the requirement weight shaped by its category weight (equal influence
 *      when the job set no category weights), normalised to fractions of one.
 *   4. The candidate score is the weighted sum of the criterion outcomes, rounded to an
 *      integer. Stored `earned_score` x `normalised_weight` reproduces it exactly.
 *   5. A hard requirement that is not `FOUND` makes the candidate `REQUIREMENT_NOT_MET` -
 *      and the candidate stays in the results. Hard requirements never hide anyone.
 */

/** Fixed, explainable outcome table. Never derived from model prose. */
export const CRITERION_OUTCOME_POINTS: Readonly<Record<EvidenceStatus, number>> = {
  FOUND: 100,
  UNCERTAIN: 50,
  NOT_FOUND: 0,
};

/** Stored as `Decimal(6,5)`; keeping 5 decimals makes the score reproducible from the rows. */
const WEIGHT_DECIMALS = 5;
/** Stored as `Decimal(5,2)`; the candidate's own score is the rounded integer. */
const SCORE_DECIMALS = 2;

export interface ScoringRequirement {
  readonly requirementId: string;
  readonly text: string;
  readonly category: ScoringCategory;
  readonly requirementClass: RequirementClass;
  readonly weight: number;
  readonly hardRequirement: boolean;
}

export interface ScoringInput {
  readonly requirements: readonly ScoringRequirement[];
  /** The grounded evidence stored on the candidate (Phase 13's envelope payload). */
  readonly evidence: { readonly criteria: readonly CriterionEvidence[] };
  /** Optional per-category weights, validated to total 100 when present. */
  readonly categoryWeights?: Readonly<Record<string, number>> | null | undefined;
}

export interface CriterionScore {
  readonly requirementId: string;
  readonly text: string;
  readonly category: ScoringCategory;
  readonly requirementClass: RequirementClass;
  readonly weight: number;
  readonly normalisedWeight: number;
  readonly hardRequirement: boolean;
  /** Status the engine used, after the confidence rule. */
  readonly status: EvidenceStatus;
  /** What the extraction reported, kept for transparency. */
  readonly reportedStatus: EvidenceStatus;
  readonly confidence: number;
  readonly earnedScore: number;
  readonly notes: string;
  readonly evidence: readonly EvidenceItem[];
  readonly confidenceDowngraded: boolean;
  /** True when the extraction returned no verdict for this requirement at all. */
  readonly missingVerdict: boolean;
}

export interface CandidateScore {
  readonly criteria: readonly CriterionScore[];
  /** Weighted sum with 2 decimals; the reproducible value behind `score`. */
  readonly rawScore: number;
  /** The candidate's score, 0-100 as stored. */
  readonly score: number;
  readonly eligibilityStatus: EligibilityStatus;
  readonly unmetHardRequirements: readonly string[];
  readonly strengths: readonly string[];
  readonly gaps: readonly string[];
  readonly uncertainties: readonly string[];
}

/** Bounded, deterministic list from criterion texts. */
const MAX_DERIVED_LINES = 20;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function withNote(notes: string, addition: string): string {
  return notes.trim().length === 0 ? addition : `${notes.trim()} ${addition}`;
}

export function scoreCandidate(input: ScoringInput): CandidateScore {
  const verdicts = new Map(
    input.evidence.criteria.map((criterion) => [criterion.requirementId, criterion]),
  );
  const categoryWeights = input.categoryWeights ?? {};

  // Influence = requirement weight x category weight (1 when the job set none).
  const effectiveWeights = input.requirements.map((requirement) => {
    const categoryFactor = Math.max(0, categoryWeights[requirement.category] ?? 1);
    return Math.max(0, requirement.weight) * categoryFactor;
  });
  const totalEffectiveWeight = effectiveWeights.reduce((total, weight) => total + weight, 0);

  const criteria: CriterionScore[] = input.requirements.map((requirement, index) => {
    const verdict = verdicts.get(requirement.requirementId);
    const reportedStatus: EvidenceStatus = verdict?.status ?? 'NOT_FOUND';
    const confidence = clamp(verdict?.confidence ?? 0, 0, 1);
    const evidence = verdict?.evidence ?? [];

    // Rule 1: only ever downgrade. A FOUND with weak confidence, or with no stored quote,
    // cannot keep full credit.
    const confidenceDowngraded =
      reportedStatus === 'FOUND' &&
      (confidence < UNCERTAIN_CONFIDENCE_THRESHOLD || evidence.length === 0);
    const status: EvidenceStatus = confidenceDowngraded ? 'UNCERTAIN' : reportedStatus;

    const effectiveWeight = effectiveWeights[index] ?? 0;
    const normalisedWeight =
      totalEffectiveWeight > 0 ? round(effectiveWeight / totalEffectiveWeight, WEIGHT_DECIMALS) : 0;

    const missingVerdict = !verdict;
    let notes = verdict?.notes ?? '';
    if (confidenceDowngraded) {
      notes = withNote(
        notes,
        `Keyakinan ${confidence.toFixed(2)} di bawah ambang ${UNCERTAIN_CONFIDENCE_THRESHOLD} atau tanpa kutipan yang terverifikasi; status diturunkan menjadi UNCERTAIN.`,
      );
    }
    if (missingVerdict) {
      notes = withNote(
        notes,
        'Ekstraksi tidak memberikan putusan untuk kriteria ini; diperlakukan sebagai belum ada bukti.',
      );
    }

    return {
      requirementId: requirement.requirementId,
      text: requirement.text,
      category: requirement.category,
      requirementClass: requirement.requirementClass,
      weight: requirement.weight,
      normalisedWeight,
      hardRequirement: requirement.hardRequirement,
      status,
      reportedStatus,
      confidence,
      earnedScore: CRITERION_OUTCOME_POINTS[status],
      notes,
      evidence,
      confidenceDowngraded,
      missingVerdict,
    };
  });

  // The stored (rounded) weights are what the score is computed from, so anyone can
  // reproduce the number from `screening_criterion_results` alone.
  const rawScore = round(
    criteria.reduce(
      (total, criterion) => total + criterion.earnedScore * criterion.normalisedWeight,
      0,
    ),
    SCORE_DECIMALS,
  );
  const score = clamp(Math.round(rawScore), 0, 100);

  const unmetHardRequirements = criteria
    .filter((criterion) => criterion.hardRequirement && criterion.status !== 'FOUND')
    .map((criterion) => criterion.text)
    .slice(0, MAX_DERIVED_LINES);

  const eligibilityStatus: EligibilityStatus =
    unmetHardRequirements.length > 0
      ? 'REQUIREMENT_NOT_MET'
      : score >= ELIGIBILITY_THRESHOLDS.HIGH_MATCH
        ? 'HIGH_MATCH'
        : score >= ELIGIBILITY_THRESHOLDS.CONSIDER
          ? 'CONSIDER'
          : 'LOW_MATCH';

  return {
    criteria,
    rawScore,
    score,
    eligibilityStatus,
    unmetHardRequirements,
    strengths: criteria
      .filter((criterion) => criterion.status === 'FOUND')
      .map((criterion) => criterion.text)
      .slice(0, MAX_DERIVED_LINES),
    gaps: criteria
      .filter((criterion) => criterion.status === 'NOT_FOUND')
      .map((criterion) => criterion.text)
      .slice(0, MAX_DERIVED_LINES),
    uncertainties: criteria
      .filter((criterion) => criterion.status === 'UNCERTAIN')
      .map((criterion) => criterion.text)
      .slice(0, MAX_DERIVED_LINES),
  };
}
