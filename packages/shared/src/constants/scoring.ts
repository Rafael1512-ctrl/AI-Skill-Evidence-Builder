import { SCORING_CATEGORIES, type ScoringCategory } from './workflow.js';

/** Human labels (Bahasa Indonesia) for scoring categories. */
export const SCORING_CATEGORY_LABELS: Readonly<Record<ScoringCategory, string>> = {
  EXPERIENCE: 'Pengalaman',
  TECHNICAL_SKILLS: 'Keahlian Teknis',
  PROJECTS: 'Proyek',
  EDUCATION: 'Pendidikan',
  PORTFOLIO: 'Portofolio',
  OTHER: 'Lainnya',
};

/**
 * Documented example of a valid category weight configuration. Category weights are
 * optional; when a recruiter supplies them they MUST total exactly 100.
 */
export const EXAMPLE_CATEGORY_WEIGHTS: Readonly<Record<ScoringCategory, number>> = {
  EXPERIENCE: 30,
  TECHNICAL_SKILLS: 25,
  PROJECTS: 20,
  EDUCATION: 10,
  PORTFOLIO: 10,
  OTHER: 5,
};

export const DEFAULT_REQUIREMENT_WEIGHT = 10;

/** Weight bounds accepted from recruiters. */
export const REQUIREMENT_WEIGHT_MIN = 1;
export const REQUIREMENT_WEIGHT_MAX = 100;

/** Score thresholds used to derive the workflow classification. */
export const ELIGIBILITY_THRESHOLDS = {
  HIGH_MATCH: 75,
  CONSIDER: 55,
  LOW_MATCH: 0,
} as const;

/** Confidence below this value marks a criterion as UNCERTAIN even if a quote exists. */
export const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.45;

/** Version of the deterministic scoring algorithm. Bump on any behaviour change. */
export const SCORING_ENGINE_VERSION = '1.0.0';

export function allScoringCategories(): readonly ScoringCategory[] {
  return SCORING_CATEGORIES;
}
