import type { Express } from 'express';
import request from 'supertest';

export interface DevSession {
  token: string;
  userId: string;
  email: string;
  role: 'USER' | 'ADMIN';
  password: string;
}

let sequence = 0;

/** Unique email per call so tests sharing one database never collide. */
export function uniqueEmail(prefix = 'user'): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}@example.com`;
}

/**
 * Creates an account through the real development sign-up endpoint and returns a
 * usable bearer token, so tests exercise the same path a contributor would.
 */
export async function signUpDevUser(
  app: Express,
  overrides: { email?: string; password?: string; fullName?: string } = {},
): Promise<DevSession> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'password-yang-kuat';
  const fullName = overrides.fullName ?? 'Pengguna Uji';

  const response = await request(app)
    .post('/api/auth/dev/sign-up')
    .send({ email, password, fullName });

  if (response.status !== 201) {
    throw new Error(`dev sign-up failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return {
    token: response.body.data.accessToken as string,
    userId: response.body.data.user.id as string,
    email,
    role: response.body.data.user.role as 'USER' | 'ADMIN',
    password,
  };
}

export function bearer(session: Pick<DevSession, 'token'>): { authorization: string } {
  return { authorization: `Bearer ${session.token}` };
}
