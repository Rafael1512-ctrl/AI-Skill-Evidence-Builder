/**
 * Stable, machine-readable error codes.
 *
 * The API always answers with `{ error: { code, message, details? } }`.
 * The frontend maps `code` to a Bahasa Indonesia message and never parses
 * human-readable text to decide what happened.
 */

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  TEXT_EXTRACTION_FAILED: 'TEXT_EXTRACTION_FAILED',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_CREDITS: 402,
  UNSUPPORTED_FILE: 415,
  FILE_TOO_LARGE: 413,
  TEXT_EXTRACTION_FAILED: 422,
  AI_PROVIDER_ERROR: 502,
  AI_RATE_LIMITED: 503,
  AI_INVALID_RESPONSE: 502,
  PAYMENT_ERROR: 402,
  JOB_NOT_FOUND: 404,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * Default user-facing copy in Bahasa Indonesia. Feature code may pass a more
 * specific message; the frontend may override for its own context.
 */
export const DEFAULT_ERROR_MESSAGES_ID: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Data yang dikirim tidak valid. Mohon periksa kembali isian Anda.',
  AUTHENTICATION_REQUIRED: 'Anda perlu masuk terlebih dahulu untuk melanjutkan.',
  INVALID_CREDENTIALS: 'Email atau kata sandi salah.',
  FORBIDDEN: 'Anda tidak memiliki akses ke bagian ini.',
  NOT_FOUND: 'Data yang Anda cari tidak ditemukan.',
  CONFLICT: 'Permintaan bentrok dengan data yang sudah ada.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.',
  INSUFFICIENT_CREDITS: 'Kredit Anda tidak cukup untuk menjalankan fitur ini.',
  UNSUPPORTED_FILE: 'Jenis file tidak didukung. Gunakan PDF untuk CV, atau ZIP untuk batch.',
  FILE_TOO_LARGE: 'Ukuran file melebihi batas yang diizinkan (maksimal 5 MB per PDF).',
  TEXT_EXTRACTION_FAILED:
    'Kami tidak dapat membaca teks dari PDF ini. PDF hasil pindai (scan) belum didukung - mohon unggah PDF berbasis teks.',
  AI_PROVIDER_ERROR: 'Layanan AI sedang bermasalah. Silakan coba lagi.',
  AI_RATE_LIMITED: 'Layanan AI sedang sibuk. Silakan coba lagi sebentar lagi.',
  AI_INVALID_RESPONSE:
    'Hasil analisis AI tidak dapat diproses dengan aman. Silakan jalankan ulang analisis.',
  PAYMENT_ERROR: 'Pembayaran tidak dapat diproses. Silakan coba lagi.',
  JOB_NOT_FOUND: 'Sesi screening tidak ditemukan.',
  UPSTREAM_UNAVAILABLE: 'Layanan pihak ketiga sedang tidak tersedia. Silakan coba lagi.',
  INTERNAL_ERROR: 'Terjadi kesalahan pada server kami. Silakan coba lagi.',
};
