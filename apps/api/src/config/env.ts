// Side-effect import: must run before anything reads process.env.
import './load-env.js';

import { z } from 'zod';

/**
 * Environment loading and validation.
 *
 * The API boots in development without external services so that contributors can
 * hack on the UI immediately; production refuses to start with missing mandatory
 * configuration. Every accessor here is pure and synchronous so modules can import
 * `env` freely.
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', 'TRUE', 'FALSE', '1', '0', ''])])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalised = value.trim().toLowerCase();
    return normalised === 'true' || normalised === '1';
  });

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : value));

const csvList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_URL: z.string().default('http://localhost:4000'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  CORS_EXTRA_ORIGINS: csvList,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: optionalString,
  DIRECT_URL: optionalString,

  SUPABASE_URL: optionalString,
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  AUTH_DEV_MODE: booleanish.default(true),
  AUTH_DEV_JWT_SECRET: optionalString,
  ADMIN_EMAILS: csvList,

  AI_PROVIDER: z.enum(['deepseek', 'mock']).default('deepseek'),
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: optionalString,
  DEEPSEEK_FALLBACK_MODELS: csvList,
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  AI_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  AI_MARKUP_MULTIPLIER: z.coerce.number().min(0).max(1000).default(2),

  REDIS_URL: optionalString,
  SCREENING_JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SCREENING_JOB_BACKOFF_MS: z.coerce.number().int().min(100).max(120_000).default(2_000),

  MAX_PDF_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * 1024 * 1024),
  MAX_SCREENING_CVS: z.coerce.number().int().min(1).max(500).default(50),
  MAX_ZIP_ENTRIES: z.coerce.number().int().min(1).max(2_000).default(100),
  MAX_ZIP_UNCOMPRESSED_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(250 * 1024 * 1024),
  MAX_ZIP_COMPRESSION_RATIO: z.coerce.number().int().min(1).default(120),
  GUEST_AUDIT_RATE_LIMIT: z.coerce.number().int().min(1).default(3),
  GUEST_AUDIT_RATE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(60),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  EXTERNAL_FETCH_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8_000),
  EXTERNAL_FETCH_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(1024 * 1024),

  PAYMENT_PROVIDER: z.enum(['mock', 'midtrans']).default('mock'),
  /** Outbound fetcher for GitHub/portfolio evidence; `mock` keeps dev and tests offline. */
  OUTBOUND_HTTP_PROVIDER: z.enum(['guarded', 'mock']).default('mock'),
  PAYMENT_MOCK_WEBHOOK_SECRET: z.string().default('dev-mock-webhook-secret'),
  MIDTRANS_SERVER_KEY: optionalString,
  MIDTRANS_CLIENT_KEY: optionalString,
  MIDTRANS_MERCHANT_ID: optionalString,
  MIDTRANS_IS_PRODUCTION: booleanish.default(false),
  /** How long a top-up attempt stays payable before it is marked EXPIRED. */
  PAYMENT_EXPIRY_MINUTES: z.coerce.number().int().min(5).max(43_200).default(1_440),

  MIN_TOPUP_IDR: z.coerce.number().int().min(1_000).default(50_000),
  CREDIT_IDR_VALUE: z.coerce.number().int().min(1).default(1_000),
  DEFAULT_TOPUP_CREDITS: z.coerce.number().int().min(1).default(50),

  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  GITHUB_TOKEN: optionalString,
  PORTFOLIO_VERIFICATION_ENABLED: booleanish.default(true),

  SUPABASE_STORAGE_BUCKET: z.string().default('aseb-artifacts'),
  SUPABASE_STORAGE_ENABLED: booleanish.default(false),

  /**
   * PDF rendering backend. `mock` is deterministic and offline (development and the
   * automated test suite); `puppeteer` renders real PDFs with Chromium.
   */
  PDF_RENDERER: z.enum(['puppeteer', 'mock']).default('mock'),
  PUPPETEER_EXECUTABLE_PATH: optionalString,
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
  /** Non-fatal configuration problems, surfaced once at startup. */
  warnings: string[];
  /** Front-end origins allowed by CORS. */
  allowedOrigins: string[];
}

function parseInput(processEnv: NodeJS.ProcessEnv): Record<string, unknown> {
  // Treat empty strings as "not set" for optional values but keep them for defaults.
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    input[key] = value;
  }
  return input;
}

function productionRequirements(parsed: RawEnv, warnings: string[]): void {
  const problems: string[] = [];

  if (!parsed.DATABASE_URL) {
    problems.push('DATABASE_URL is required in production.');
  }
  if (!parsed.SUPABASE_URL || !parsed.SUPABASE_ANON_KEY || !parsed.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push(
      'SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required in production.',
    );
  }
  if (parsed.AUTH_DEV_MODE) {
    problems.push(
      'AUTH_DEV_MODE must be false in production: the development token strategy is not secure.',
    );
  }
  if (parsed.AI_PROVIDER === 'deepseek' && !parsed.DEEPSEEK_API_KEY) {
    problems.push('DEEPSEEK_API_KEY is required when AI_PROVIDER=deepseek.');
  }
  if (parsed.AI_PROVIDER === 'deepseek' && !parsed.DEEPSEEK_MODEL) {
    problems.push(
      'DEEPSEEK_MODEL is required when AI_PROVIDER=deepseek (model ids must not be hardcoded).',
    );
  }
  if (parsed.PAYMENT_PROVIDER === 'midtrans' && !parsed.MIDTRANS_SERVER_KEY) {
    problems.push('MIDTRANS_SERVER_KEY is required when PAYMENT_PROVIDER=midtrans.');
  }
  if (parsed.PAYMENT_PROVIDER === 'mock') {
    warnings.push(
      'PAYMENT_PROVIDER=mock: top-ups cannot be paid for real and no gateway is contacted.',
    );
  }
  if (!parsed.REDIS_URL) {
    warnings.push(
      'REDIS_URL is not set: the in-process queue driver will be used. This is not safe for multi-instance deployments.',
    );
  }
  if (!parsed.GITHUB_TOKEN) {
    warnings.push(
      'GITHUB_TOKEN is not set: GitHub evidence lookups are limited to 60 requests/hour.',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      ['Invalid production configuration:', ...problems.map((line) => `  - ${line}`)].join('\n'),
    );
  }
}

function developmentWarnings(parsed: RawEnv, warnings: string[]): void {
  if (!parsed.DATABASE_URL) {
    warnings.push(
      'DATABASE_URL is not set. Endpoints that persist data will fail until it is configured.',
    );
  }
  if (parsed.AUTH_DEV_MODE) {
    warnings.push(
      'AUTH_DEV_MODE is enabled: bearer tokens are verified with a local secret. Never enable this in production.',
    );
  }
  if (parsed.AI_PROVIDER === 'deepseek' && !parsed.DEEPSEEK_API_KEY) {
    warnings.push(
      'DEEPSEEK_API_KEY is not set. Set AI_PROVIDER=mock or provide a key before running AI features.',
    );
  }
  if (parsed.AI_PROVIDER === 'deepseek' && !parsed.DEEPSEEK_MODEL) {
    warnings.push(
      'DEEPSEEK_MODEL is not set. Set it explicitly so a provider model rename cannot break the product silently.',
    );
  }
}

export function loadEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Record<string, unknown>> = {},
): AppEnv {
  const input = { ...parseInput(processEnv), ...overrides };
  const result = envSchema.safeParse(input);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(['Invalid environment configuration:', ...lines].join('\n'));
  }

  const parsed = result.data;
  const warnings: string[] = [];
  const isProduction = parsed.NODE_ENV === 'production';

  if (isProduction) {
    productionRequirements(parsed, warnings);
  } else {
    developmentWarnings(parsed, warnings);
  }

  const allowedOrigins = Array.from(new Set([parsed.FRONTEND_URL, ...parsed.CORS_EXTRA_ORIGINS]));

  return Object.freeze({
    ...parsed,
    isProduction,
    isTest: parsed.NODE_ENV === 'test',
    isDevelopment: parsed.NODE_ENV === 'development',
    warnings,
    allowedOrigins,
  });
}

let cached: AppEnv | null = null;

/** Memoised environment for application code. Tests may call `resetEnvCache()`. */
export function getEnv(): AppEnv {
  cached ??= loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

/**
 * Lazily-resolved environment.
 *
 * A proxy rather than a frozen snapshot, so `env.DATABASE_URL` always reflects the
 * current process environment. This matters for tests, which inject a database URL
 * after modules have already been imported, and for CLIs that mutate configuration.
 */
export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, property): unknown {
    if (typeof property === 'symbol') return undefined;
    return Reflect.get(getEnv() as unknown as object, property);
  },
  has(_target, property): boolean {
    return Reflect.has(getEnv() as unknown as object, property);
  },
  ownKeys(): string[] {
    return Reflect.ownKeys(getEnv() as unknown as object) as string[];
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(getEnv() as unknown as object, property);
  },
});

/** True when a database connection has been configured. */
export function hasDatabaseUrl(config: AppEnv = env): boolean {
  return typeof config.DATABASE_URL === 'string' && config.DATABASE_URL.length > 0;
}

export function isAiProviderConfigured(config: AppEnv = env): boolean {
  if (config.AI_PROVIDER === 'mock') return true;
  return Boolean(config.DEEPSEEK_API_KEY);
}
