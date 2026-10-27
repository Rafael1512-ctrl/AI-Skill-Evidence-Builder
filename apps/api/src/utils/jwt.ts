import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { AppError } from './errors.js';

export interface VerifiedToken {
  subject: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  provider: 'PASSWORD' | 'GOOGLE';
}

interface SupabaseConfig {
  url: string;
  /** Expected audience; Supabase issues `authenticated` for signed-in users. */
  audience?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl: string | null = null;

function getJwks(supabaseUrl: string) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  return jwks;
}

/**
 * Verifies a Supabase access token against the project's JWKS.
 *
 * Signature verification happens locally against cached public keys; no round trip to
 * Supabase is required per request.
 */
export async function verifySupabaseToken(
  token: string,
  config: SupabaseConfig,
): Promise<VerifiedToken> {
  try {
    const { payload } = await jwtVerify(token, getJwks(config.url), {
      issuer: `${config.url.replace(/\/$/, '')}/auth/v1`,
      ...(config.audience ? { audience: config.audience } : {}),
    });

    const subject = typeof payload.sub === 'string' ? payload.sub : null;
    if (!subject) throw AppError.authenticationRequired('Token tidak memiliki subject.');

    const provider = resolveAuthProvider(payload.app_metadata);

    return {
      subject,
      email: typeof payload.email === 'string' ? payload.email : null,
      fullName: readString(payload.user_metadata, 'full_name'),
      avatarUrl: readString(payload.user_metadata, 'avatar_url'),
      emailVerified: Boolean(payload.email_confirmed_at) || provider === 'GOOGLE',
      provider,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.authenticationRequired('Sesi Anda tidak valid atau sudah kedaluwarsa.');
  }
}

/**
 * Reads the identity provider from a Supabase token's `app_metadata`.
 *
 * Supabase reports the provider that *started* the session in `provider`, and every
 * linked provider in `providers`. A Google identity that was linked to an
 * email/password account keeps `provider: 'email'` while Google shows up only in
 * `providers`, so both signals must be considered - otherwise `googleConnected`
 * never becomes true for linked accounts.
 */
export function resolveAuthProvider(appMetadata: unknown): 'PASSWORD' | 'GOOGLE' {
  const metadata = (appMetadata ?? {}) as { provider?: unknown; providers?: unknown };
  const candidates: string[] = [];

  if (typeof metadata.provider === 'string') candidates.push(metadata.provider);
  if (Array.isArray(metadata.providers)) {
    for (const entry of metadata.providers) {
      if (typeof entry === 'string') candidates.push(entry);
    }
  }

  return candidates.some((entry) => entry.toLowerCase() === 'google') ? 'GOOGLE' : 'PASSWORD';
}

function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Development-only token strategy (HS256, local secret).
 *
 * Enabled with AUTH_DEV_MODE=true for offline development and automated tests. The API
 * refuses to start in production with this mode enabled.
 */
export async function signDevToken(
  payload: { subject: string; email: string; fullName?: string | null; role?: 'USER' | 'ADMIN' },
  secret: string,
  expiresIn = '7d',
): Promise<string> {
  return new SignJWT({
    email: payload.email,
    full_name: payload.fullName ?? null,
    role: payload.role ?? 'USER',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.subject)
    .setIssuedAt()
    .setIssuer('aseb-dev')
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyDevToken(token: string, secret: string): Promise<VerifiedToken> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: 'aseb-dev',
    });

    const subject = typeof payload.sub === 'string' ? payload.sub : null;
    if (!subject) throw AppError.authenticationRequired();

    return {
      subject,
      email: typeof payload.email === 'string' ? payload.email : null,
      fullName: typeof payload.full_name === 'string' ? payload.full_name : null,
      avatarUrl: null,
      // The development strategy is local-only; accounts it creates are treated as verified.
      emailVerified: true,
      provider: 'PASSWORD',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.authenticationRequired('Sesi pengembangan tidak valid atau sudah kedaluwarsa.');
  }
}

export type { JWTPayload };
