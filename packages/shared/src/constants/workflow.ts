/**
 * Explicit workflow state machines. Strings are stored in the database, so
 * changing a value is a migration, not a rename.
 */

/** Screening job lifecycle. */
export const SCREENING_JOB_STATES = [
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type ScreeningJobState = (typeof SCREENING_JOB_STATES)[number];

/** Per-candidate processing lifecycle inside a screening job. */
export const SCREENING_CANDIDATE_STATES = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export type ScreeningCandidateState = (typeof SCREENING_CANDIDATE_STATES)[number];

/**
 * Evidence status for a single screening criterion.
 *
 * NOT_FOUND means "no supporting evidence exists in the available input" - it is
 * NOT a statement about the candidate's honesty or capability.
 */
export const EVIDENCE_STATUSES = ['FOUND', 'NOT_FOUND', 'UNCERTAIN'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Where a piece of evidence came from. */
export const EVIDENCE_SOURCES = [
  'CV',
  'GITHUB',
  'PORTFOLIO',
  'LINKEDIN_SELF_REPORTED',
  'USER_INPUT',
  'JOB_DESCRIPTION',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** Requirement importance inside a screening job. */
export const REQUIREMENT_CLASSES = ['REQUIRED', 'PREFERRED', 'BONUS'] as const;
export type RequirementClass = (typeof REQUIREMENT_CLASSES)[number];

/** Recruitment workflow classification - never a claim about a person's worth. */
export const ELIGIBILITY_STATUSES = [
  'HIGH_MATCH',
  'CONSIDER',
  'LOW_MATCH',
  'REQUIREMENT_NOT_MET',
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/** Weight categories used for deterministic scoring. */
export const SCORING_CATEGORIES = [
  'EXPERIENCE',
  'TECHNICAL_SKILLS',
  'PROJECTS',
  'EDUCATION',
  'PORTFOLIO',
  'OTHER',
] as const;
export type ScoringCategory = (typeof SCORING_CATEGORIES)[number];

/**
 * Evidence verification vocabulary. Deliberately not a "fake CV detector":
 * the system evaluates consistency and supporting evidence.
 */
export const VERIFICATION_STATUSES = [
  'VERIFIED_EVIDENCE',
  'SUPPORTED',
  'UNVERIFIED',
  'CONFLICTING_INFORMATION',
  'NOT_CHECKED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Credit ledger transaction types. */
export const CREDIT_TRANSACTION_TYPES = [
  'TOP_UP',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'USAGE',
  'REFUND',
  'ADJUSTMENT',
] as const;
export type CreditTransactionType = (typeof CREDIT_TRANSACTION_TYPES)[number];

/** Credit reservation lifecycle. */
export const RESERVATION_STATES = [
  'ACTIVE',
  'SETTLED',
  'RELEASED',
  'EXPIRED',
] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

/** Payment transaction lifecycle. */
export const PAYMENT_STATUSES = [
  'CREATED',
  'PENDING',
  'PAID',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Testimonials are moderated before they can appear publicly. */
export const TESTIMONIAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

/** Stored CV artifacts. */
export const CV_DOCUMENT_KINDS = ['ORIGINAL', 'ENHANCED'] as const;
export type CvDocumentKind = (typeof CV_DOCUMENT_KINDS)[number];

/** Built-in export templates. */
export const CV_TEMPLATE_KEYS = ['ATS_MINIMAL', 'PROFESSIONAL', 'MODERN'] as const;
export type CvTemplateKey = (typeof CV_TEMPLATE_KEYS)[number];

export const CV_TEMPLATES: ReadonlyArray<{
  key: CvTemplateKey;
  name: string;
  description: string;
  accent: string;
}> = [
  {
    key: 'ATS_MINIMAL',
    name: 'ATS Minimal',
    description:
      'Satu kolom, tanpa grafik, tanpa tabel. Paling aman untuk sistem ATS dan paling mudah dibaca mesin.',
    accent: '#0f172a',
  },
  {
    key: 'PROFESSIONAL',
    name: 'Professional',
    description:
      'Tata letak formal dengan garis pemisah dan hierarki tipografi yang tegas untuk posisi korporat.',
    accent: '#1d4ed8',
  },
  {
    key: 'MODERN',
    name: 'Modern',
    description:
      'Header berwarna, aksen tegas, dan tata letak dua kolom yang tetap ramah ATS.',
    accent: '#6d28d9',
  },
];

/** Report export formats for screening results. */
export const REPORT_FORMATS = ['PDF', 'CSV'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
