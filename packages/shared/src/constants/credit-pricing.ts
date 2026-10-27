/**
 * Central credit pricing.
 *
 * These are DEFAULTS. The database table `FeaturePricing` may override any of them,
 * and admin UI can change an override safely. Never hardcode a credit cost anywhere
 * else in the codebase - always resolve it through the pricing service.
 *
 * Users see credits ("5 Kredit"), never provider token counts or rupiah-per-AI-call.
 */

export const FEATURE_KEYS = [
  'FREE_CV_AUDIT',
  'CV_DEEP_ANALYSIS',
  'CV_ENHANCEMENT',
  'CV_REGENERATE',
  'CV_PDF_EXPORT',
  'EVIDENCE_VERIFICATION',
  'HRD_SCREEN_PER_CV',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeaturePricingDefinition {
  readonly credits: number;
  /** User-facing label (Bahasa Indonesia). */
  readonly label: string;
  readonly description: string;
  /** Stable ordering for admin tables. */
  readonly sortOrder: number;
}

export const DEFAULT_FEATURE_PRICING: Readonly<Record<FeatureKey, FeaturePricingDefinition>> = {
  FREE_CV_AUDIT: {
    credits: 0,
    label: 'Audit CV Gratis',
    description: 'Analisis awal CV tanpa biaya kredit, tersedia juga untuk tamu.',
    sortOrder: 10,
  },
  CV_DEEP_ANALYSIS: {
    credits: 2,
    label: 'Analisis CV Mendalam',
    description: 'Analisis tambahan yang lebih rinci untuk CV yang sudah tersimpan.',
    sortOrder: 20,
  },
  CV_ENHANCEMENT: {
    credits: 5,
    label: 'Peningkatan CV',
    description: 'Penyempurnaan isi CV lengkap dengan pratinjau Before vs After.',
    sortOrder: 30,
  },
  CV_REGENERATE: {
    credits: 3,
    label: 'Buat Ulang CV',
    description: 'Menghasilkan ulang CV dari data yang sudah ada tanpa menganalisis ulang.',
    sortOrder: 40,
  },
  CV_PDF_EXPORT: {
    credits: 1,
    label: 'Ekspor PDF',
    description: 'Mencetak CV yang sudah disempurnakan ke PDF dengan template pilihan.',
    sortOrder: 50,
  },
  EVIDENCE_VERIFICATION: {
    credits: 2,
    label: 'Verifikasi Bukti',
    description: 'Pemeriksaan bukti tambahan seperti GitHub atau portofolio untuk satu CV.',
    sortOrder: 60,
  },
  HRD_SCREEN_PER_CV: {
    credits: 1,
    label: 'Screening per CV',
    description: 'Satu CV diproses dalam satu batch screening HRD.',
    sortOrder: 70,
  },
};

/** Features that exist for analytics/admin purposes but are never billed to a user. */
export const NON_BILLABLE_FEATURES: readonly FeatureKey[] = ['FREE_CV_AUDIT'];

export function isBillableFeature(feature: FeatureKey): boolean {
  return !NON_BILLABLE_FEATURES.includes(feature);
}

/**
 * One credit has a fixed sale value of Rp1.000. Minimum top-up is Rp50.000.
 * Discounts are NOT applied unless explicitly configured by an admin.
 */
export const CREDIT_ECONOMY = {
  MIN_TOPUP_IDR: 50_000,
  CREDIT_IDR_VALUE: 1_000,
  DEFAULT_TOPUP_CREDITS: 50,
} as const;

export interface TopUpPackage {
  readonly id: string;
  readonly credits: number;
  readonly priceIdr: number;
  readonly label: string;
  readonly highlight: boolean;
}

export const TOPUP_PACKAGES: readonly TopUpPackage[] = [
  { id: 'credits-50', credits: 50, priceIdr: 50_000, label: '50 Kredit', highlight: false },
  { id: 'credits-100', credits: 100, priceIdr: 100_000, label: '100 Kredit', highlight: true },
  { id: 'credits-200', credits: 200, priceIdr: 200_000, label: '200 Kredit', highlight: false },
];

/** Guard rail for admin-editable pricing. */
export const MAX_FEATURE_CREDIT_COST = 1_000;

export function resolveFeatureCredits(
  feature: FeatureKey,
  overrides?: Partial<Record<FeatureKey, number>> | null,
): number {
  const override = overrides?.[feature];
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  return DEFAULT_FEATURE_PRICING[feature].credits;
}

/** Rupiah price of a custom credit amount at the fixed sale value. */
export function topUpAmountIdr(credits: number): number {
  return Math.floor(credits) * CREDIT_ECONOMY.CREDIT_IDR_VALUE;
}

/** Credits a given rupiah amount buys at the fixed sale value. */
export function topUpCreditsForIdr(amountIdr: number): number {
  return Math.floor(amountIdr / CREDIT_ECONOMY.CREDIT_IDR_VALUE);
}

/** Looks up a curated top-up package; `undefined` for an unknown id. */
export function findTopUpPackage(packageId: string): TopUpPackage | undefined {
  return TOPUP_PACKAGES.find((pkg) => pkg.id === packageId);
}
