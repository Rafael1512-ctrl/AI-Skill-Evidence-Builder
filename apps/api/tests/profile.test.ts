import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { withEnv } from './helpers/env.js';

const PROFILE_KEYS = [
  'avatarUrl',
  'createdAt',
  'email',
  'emailVerified',
  'fullName',
  'githubUrl',
  'githubUsername',
  'googleConnected',
  'hasPassword',
  'headline',
  'id',
  'linkedinUrl',
  'location',
  'phone',
  'portfolioUrl',
  'role',
  'updatedAt',
];

/**
 * Self-service profile management (Phase 4).
 *
 * The route owns only the fields a user may change about themselves; email, role,
 * credentials and recruiter preferences must stay out of reach.
 */
describe('profile', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let session: DevSession;

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
    session = await signUpDevUser(app);
  });

  it('requires a session', async () => {
    const response = await request(app).get('/api/profile');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const patch = await request(app).patch('/api/profile').send({ fullName: 'Anonim' });
    expect(patch.status).toBe(401);
  });

  it('returns the profile with exactly the user-facing fields', async () => {
    const response = await request(app).get('/api/profile').set(bearer(session));

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data.profile).sort()).toEqual(PROFILE_KEYS);
    expect(response.body.data.profile).toMatchObject({
      id: session.userId,
      email: session.email,
      role: 'USER',
      fullName: 'Pengguna Uji',
      headline: null,
      phone: null,
      location: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      hasPassword: true,
      googleConnected: false,
    });
  });

  it('updates the fields a user owns', async () => {
    const response = await request(app).patch('/api/profile').set(bearer(session)).send({
      fullName: 'Siti Rahmawati',
      headline: 'Backend Engineer',
      phone: '+628123456789',
      location: 'Jakarta',
      linkedinUrl: 'https://www.linkedin.com/in/siti',
      githubUrl: 'https://github.com/siti',
      portfolioUrl: 'https://siti.example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.profile).toMatchObject({
      fullName: 'Siti Rahmawati',
      headline: 'Backend Engineer',
      phone: '+628123456789',
      location: 'Jakarta',
      linkedinUrl: 'https://www.linkedin.com/in/siti',
      githubUrl: 'https://github.com/siti',
      portfolioUrl: 'https://siti.example.com',
    });

    const persisted = await request(app).get('/api/profile').set(bearer(session));
    expect(persisted.body.data.profile.headline).toBe('Backend Engineer');
  });

  it('clears optional fields with null or an empty string', async () => {
    await request(app)
      .patch('/api/profile')
      .set(bearer(session))
      .send({ headline: 'Sementara', githubUrl: 'https://github.com/siti' });

    const cleared = await request(app)
      .patch('/api/profile')
      .set(bearer(session))
      .send({ headline: null, githubUrl: '' });

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.profile.headline).toBeNull();
    expect(cleared.body.data.profile.githubUrl).toBeNull();
  });

  it('leaves untouched fields alone on a partial update', async () => {
    await request(app).patch('/api/profile').set(bearer(session)).send({ location: 'Bandung' });

    const response = await request(app)
      .patch('/api/profile')
      .set(bearer(session))
      .send({ phone: '+6281111111' });

    expect(response.body.data.profile.location).toBe('Bandung');
    expect(response.body.data.profile.phone).toBe('+6281111111');
  });

  it('rejects invalid URLs and empty payloads', async () => {
    const badUrl = await request(app)
      .patch('/api/profile')
      .set(bearer(session))
      .send({ githubUrl: 'not-a-url' });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error.code).toBe('VALIDATION_ERROR');

    const empty = await request(app).patch('/api/profile').set(bearer(session)).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses to change email, role or credits through the profile route', async () => {
    const response = await request(app)
      .patch('/api/profile')
      .set(bearer(session))
      .send({ role: 'ADMIN', email: 'attacker@example.com' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    const me = await request(app).get('/api/auth/me').set(bearer(session));
    expect(me.body.data.user.role).toBe('USER');
    expect(me.body.data.user.email).toBe(session.email);
  });

  it("cannot read or write another user's profile", async () => {
    await request(app).patch('/api/profile').set(bearer(session)).send({ fullName: 'Milik Saya' });

    const other = await signUpDevUser(app, { fullName: 'Orang Lain' });
    const otherProfile = await request(app).get('/api/profile').set(bearer(other));

    expect(otherProfile.body.data.profile.fullName).toBe('Orang Lain');
    expect(otherProfile.body.data.profile.id).not.toBe(session.userId);
  });

  it('reports Google linking as unavailable without Supabase configuration', async () => {
    const response = await request(app).get('/api/profile').set(bearer(session));

    expect(response.body.data.googleLink).toMatchObject({
      supported: false,
      method: null,
      redirectTo: null,
    });
    expect(response.body.data.googleLink.reason).toContain('Supabase');
  });

  it('offers the Supabase linking method once Google linking is configured', async () => {
    await withEnv(
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      async () => {
        const state = await request(app).get('/api/profile').set(bearer(session));
        expect(state.body.data.googleLink).toMatchObject({
          supported: true,
          reason: null,
          method: 'SUPABASE_LINK_IDENTITY',
          redirectTo: 'http://localhost:5173/profile',
        });

        const connect = await request(app).post('/api/profile/google/connect').set(bearer(session));
        expect(connect.status).toBe(200);
        expect(connect.body.data.googleLink.method).toBe('SUPABASE_LINK_IDENTITY');
      },
    );
  });

  it('rejects a Google connect preflight when Supabase is not configured', async () => {
    const response = await request(app).post('/api/profile/google/connect').set(bearer(session));

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('reports a conflict when Google is already connected', async () => {
    await ctx.prisma.user.update({
      where: { id: session.userId },
      data: { googleConnected: true },
    });

    const state = await request(app).get('/api/profile').set(bearer(session));
    expect(state.body.data.profile.googleConnected).toBe(true);
    expect(state.body.data.googleLink.supported).toBe(false);

    await withEnv(
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      async () => {
        const response = await request(app)
          .post('/api/profile/google/connect')
          .set(bearer(session));
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('CONFLICT');
      },
    );
  });
});
