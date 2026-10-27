/** Hard product limits shared by the API, the workers, the UI copy and the tests. */
export const LIMITS = {
  /** Per-file PDF ceiling (5 MB). */
  MAX_PDF_BYTES: 5 * 1024 * 1024,
  /** Candidate CVs per screening batch. */
  MAX_SCREENING_CVS: 50,
  /** Upstream request ceiling for a single ZIP batch upload (PDFs compress poorly). */
  MAX_BATCH_ZIP_BYTES: 64 * 1024 * 1024,
  /** ZIP entries allowed in an upload archive. */
  MAX_ZIP_ENTRIES: 100,
  /** Total uncompressed bytes allowed from a single ZIP. */
  MAX_ZIP_UNCOMPRESSED_BYTES: 250 * 1024 * 1024,
  /** Reject archives whose compression ratio suggests a zip bomb. */
  MAX_ZIP_COMPRESSION_RATIO: 120,
  /** Guest free-audit allowance per IP per window. */
  GUEST_AUDIT_RATE_LIMIT: 3,
  GUEST_AUDIT_RATE_WINDOW_MINUTES: 60,
  /** Generic API rate limit. */
  API_RATE_LIMIT_PER_MINUTE: 120,
  /** Request body ceiling for JSON payloads. */
  MAX_JSON_BODY_BYTES: 1 * 1024 * 1024,
  /** Outbound fetches (portfolio verification) must stay small and fast. */
  EXTERNAL_FETCH_TIMEOUT_MS: 8_000,
  EXTERNAL_FETCH_MAX_BYTES: 1 * 1024 * 1024,
  /** Bounds for AI-extracted evidence quotes. */
  MAX_EVIDENCE_QUOTE_CHARS: 320,
  /** Screening preferences: number of entries accepted per list. */
  MAX_PREFERENCE_ITEMS: 50,
} as const;

export const MIME_TYPES = {
  PDF: 'application/pdf',
} as const;

export const SUPPORTED_UPLOAD_EXTENSIONS = ['.pdf', '.zip'] as const;
