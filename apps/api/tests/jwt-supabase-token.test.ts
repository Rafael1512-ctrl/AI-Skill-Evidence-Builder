import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveAuthProvider, verifySupabaseToken } from '../src/utils/jwt.js';

/**
 * Supabase access-token verification, without a network or a database.
 *
 * The JWKS endpoint the verifier fetches is stubbed with a locally generated key pair,
 * so the real `jose` verification path runs while the provider metadata mapping - the
 * part that decides whether an account is reported as Google-connected - is exercised
 * for every shape Supabase emits.
 */

const SUPABASE_URL = 'https://jwks-test.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const SUBJECT = '11111111-1111-1111-1111-111111111111';

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;

  const publicJwk: JWK = {
    ...(await exportJWK(pair.publicKey)),
    alg: 'ES256',
    use: 'sig',
    kid: 'test-key',
  };

  vi.stubGlobal('fetch', async () => {
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

interface TokenClaims {
  email?: string;
  app_metadata?: unknown;
  user_metadata?: unknown;
  email_confirmed_at?: string;
  issuer?: string;
  audience?: string;
}

async function signToken(claims: TokenClaims = {}): Promise<string> {
  return new SignJWT({
    email: claims.email ?? 'siti@example.com',
    ...(claims.app_metadata !== undefined ? { app_metadata: claims.app_metadata } : {}),
    ...(claims.user_metadata !== undefined ? { user_metadata: claims.user_metadata } : {}),
    ...(claims.email_confirmed_at !== undefined
      ? { email_confirmed_at: claims.email_confirmed_at }
      : {}),
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(SUBJECT)
    .setIssuer(claims.issuer ?? ISSUER)
    .setAudience(claims.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(signingKey);
}

function verify(token: string) {
  return verifySupabaseToken(token, { url: SUPABASE_URL, audience: 'authenticated' });
}

describe('resolveAuthProvider', () => {
  it('detects Google from the session provider or from the linked providers list', () => {
    expect(resolveAuthProvider({ provider: 'google' })).toBe('GOOGLE');
    expect(resolveAuthProvider({ provider: 'GOOGLE' })).toBe('GOOGLE');
    expect(resolveAuthProvider({ provider: 'email', providers: ['email', 'google'] })).toBe(
      'GOOGLE',
    );
    expect(resolveAuthProvider({ providers: ['google'] })).toBe('GOOGLE');
  });

  it('treats anything else, including malformed metadata, as password auth', () => {
    expect(resolveAuthProvider({ provider: 'email', providers: ['email'] })).toBe('PASSWORD');
    expect(resolveAuthProvider({ providers: 'google' })).toBe('PASSWORD');
    expect(resolveAuthProvider(undefined)).toBe('PASSWORD');
    expect(resolveAuthProvider(null)).toBe('PASSWORD');
  });
});

describe('verifySupabaseToken', () => {
  it('verifies a Google sign-in and marks the email as verified', async () => {
    const token = await signToken({
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Siti Rahma', avatar_url: 'https://example.com/avatar.png' },
    });

    await expect(verify(token)).resolves.toEqual({
      subject: SUBJECT,
      email: 'siti@example.com',
      fullName: 'Siti Rahma',
      avatarUrl: 'https://example.com/avatar.png',
      emailVerified: true,
      provider: 'GOOGLE',
    });
  });

  it('reports a linked Google identity as Google-connected even when the session provider is email', async () => {
    const token = await signToken({
      app_metadata: { provider: 'email', providers: ['email', 'google'] },
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
    });

    const verified = await verify(token);

    expect(verified.provider).toBe('GOOGLE');
    expect(verified.emailVerified).toBe(true);
  });

  it('keeps an unconfirmed password session unverified', async () => {
    const token = await signToken({ app_metadata: { provider: 'email', providers: ['email'] } });

    const verified = await verify(token);

    expect(verified.provider).toBe('PASSWORD');
    expect(verified.emailVerified).toBe(false);
    expect(verified.fullName).toBeNull();
  });

  it('rejects a token issued for another audience', async () => {
    const token = await signToken({ audience: 'anon', app_metadata: { provider: 'email' } });

    await expect(verify(token)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });

  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('ES256', { extractable: true });
    const token = await new SignJWT({ email: 'siti@example.com' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(SUBJECT)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(other.privateKey);

    await expect(verify(token)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
  });
});
