import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { signDevToken } from '../src/utils/jwt.js';
import { bearer, signUpDevUser, uniqueEmail } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { withEnv } from './helpers/env.js';

/**
 * Authentication behaviour for Phase 4.
 *
 * These run against the real PGlite database and the real Express app, so the dev
 * strategy, the token verification path, role bootstrapping and the wallet bootstrap
 * are exercised end to end rather than mocked.
 */
describe('authentication', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ app } = await import('../src/server.test-helper.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    resetRateLimits();
  });

  it('creates an account through the development sign-up strategy', async () => {
    const email = uniqueEmail('signup').toUpperCase();
    const session = await signUpDevUser(app, { email, fullName: 'Siti Rahma' });

    expect(session.token).toBeTruthy();
    expect(session.role).toBe('USER');

    const me = await request(app).get('/api/auth/me').set(bearer(session));

    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({
      id: session.userId,
      email: email.toLowerCase(),
      fullName: 'Siti Rahma',
      role: 'USER',
      emailVerified: true,
      hasPassword: true,
      googleConnected: false,
    });
    expect(me.body.data.wallet).toEqual({ balance: 0, reserved: 0, available: 0 });
    expect(me.body.data.authStrategy).toBe('DEV');
  });

  it('rejects an email that is already registered', async () => {
    const email = uniqueEmail('duplicate');
    await signUpDevUser(app, { email });

    const response = await request(app)
      .post('/api/auth/dev/sign-up')
      .send({ email, password: 'password-yang-kuat', fullName: 'Kedua' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects a malformed sign-up payload before touching the database', async () => {
    const response = await request(app)
      .post('/api/auth/dev/sign-up')
      .send({ email: 'bukan-email', password: 'pendek', fullName: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('signs in with the right password and refuses the wrong one', async () => {
    const session = await signUpDevUser(app);

    const ok = await request(app)
      .post('/api/auth/dev/sign-in')
      .send({ email: session.email, password: session.password });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();

    const wrong = await request(app)
      .post('/api/auth/dev/sign-in')
      .send({ email: session.email, password: 'kata-sandi-salah' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives the same error for an unknown email as for a wrong password', async () => {
    const response = await request(app)
      .post('/api/auth/dev/sign-in')
      .send({ email: uniqueEmail('ghost'), password: 'kata-sandi-salah' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('does not create a second identity row once a bearer token is used', async () => {
    const session = await signUpDevUser(app);

    await request(app).get('/api/auth/me').set(bearer(session));
    const signIn = await request(app)
      .post('/api/auth/dev/sign-in')
      .send({ email: session.email, password: session.password });
    await request(app)
      .get('/api/auth/me')
      .set({ authorization: `Bearer ${signIn.body.data.accessToken}` });

    const identities = await ctx.prisma.authIdentity.count({ where: { userId: session.userId } });
    expect(identities).toBe(1);
  });

  it('requires a token for /api/auth/me', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('refuses malformed and wrongly-signed tokens', async () => {
    const malformed = await request(app)
      .get('/api/auth/me')
      .set('authorization', 'Bearer not-a-jwt');
    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const forged = await signDevToken(
      { subject: 'someone', email: 'attacker@example.com', role: 'ADMIN' },
      'the-wrong-secret',
    );
    const forgedResponse = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${forged}`);
    expect(forgedResponse.status).toBe(401);
    expect(forgedResponse.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const missingScheme = await request(app).get('/api/auth/me').set('authorization', 'Basic abc');
    expect(missingScheme.status).toBe(401);
  });

  it('never returns credential material to the client', async () => {
    const session = await signUpDevUser(app);
    const response = await request(app).get('/api/auth/me').set(bearer(session));

    const payload = JSON.stringify(response.body);
    expect(payload).not.toContain('passwordHash');
    expect(payload).not.toContain('passwordSalt');
    expect(payload).not.toContain('password-hash');
    expect(Object.keys(response.body.data.user).sort()).toEqual(
      [
        'avatarUrl',
        'createdAt',
        'email',
        'emailVerified',
        'fullName',
        'googleConnected',
        'hasPassword',
        'id',
        'role',
      ].sort(),
    );
  });

  it('disables the local credential endpoints when AUTH_DEV_MODE is off', async () => {
    await withEnv({ AUTH_DEV_MODE: 'false' }, async () => {
      const response = await request(app)
        .post('/api/auth/dev/sign-up')
        .send({
          email: uniqueEmail('prod'),
          password: 'password-yang-kuat',
          fullName: 'Tidak Aktif',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  it('bootstraps the ADMIN role from ADMIN_EMAILS', async () => {
    const email = uniqueEmail('boss');
    await withEnv({ ADMIN_EMAILS: email }, async () => {
      const session = await signUpDevUser(app, { email });

      expect(session.role).toBe('ADMIN');

      const me = await request(app).get('/api/auth/me').set(bearer(session));
      expect(me.body.data.user.role).toBe('ADMIN');
    });
  });
});
