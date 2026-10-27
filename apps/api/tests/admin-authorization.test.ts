import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { requireAdmin, requireAuth } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { requestContext } from '../src/middleware/request-context.js';
import { bearer, signUpDevUser, uniqueEmail } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { withEnv } from './helpers/env.js';

/**
 * Admin authorization (Phase 4).
 *
 * The `/api/admin/*` surface arrives in Phase 18, so `requireAdmin()` is mounted here on
 * a throwaway probe route. That is the point of the test: the middleware - not any
 * particular feature route - is the security boundary, and the role is re-read from the
 * database on every request instead of being trusted from a token claim.
 */
function buildAdminProbe(): Express {
  const probe = express();
  probe.use(requestContext);
  probe.use(express.json());
  probe.get('/api/admin/probe', requireAuth(), requireAdmin(), (_req, res) => {
    res.json({ data: { ok: true } });
  });
  probe.use(errorHandler);
  return probe;
}

describe('admin authorization', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let probe: Express;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ app } = await import('../src/server.test-helper.js'));
    probe = buildAdminProbe();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    resetRateLimits();
  });

  it('refuses an anonymous request to an admin route', async () => {
    const response = await request(probe).get('/api/admin/probe');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('refuses a normal user hitting an admin route', async () => {
    const session = await signUpDevUser(app);
    expect(session.role).toBe('USER');

    const response = await request(probe).get('/api/admin/probe').set(bearer(session));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses a user whose token claims ADMIN but whose account is not one', async () => {
    const session = await signUpDevUser(app);

    // Forge nothing: the role is dropped in the database, which is the only source of truth.
    await ctx.prisma.user.update({ where: { id: session.userId }, data: { role: 'USER' } });
    const response = await request(probe).get('/api/admin/probe').set(bearer(session));

    expect(response.status).toBe(403);
  });

  it('allows an account that is an admin in the database', async () => {
    const session = await signUpDevUser(app);
    await ctx.prisma.user.update({ where: { id: session.userId }, data: { role: 'ADMIN' } });

    // The token was issued while the account was a normal user, so a passing request
    // proves the claim is ignored in favour of the stored role.
    const response = await request(probe).get('/api/admin/probe').set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ ok: true });
  });

  it('revokes access for a demoted admin holding a still-valid ADMIN token', async () => {
    const email = uniqueEmail('demoted-admin');
    let token = '';

    await withEnv({ ADMIN_EMAILS: email }, async () => {
      const session = await signUpDevUser(app, { email });
      expect(session.role).toBe('ADMIN');
      expect((await request(probe).get('/api/admin/probe').set(bearer(session))).status).toBe(200);
      token = session.token;
    });

    // The bootstrap email is gone and the stored role is back to USER; the token itself
    // is untouched and still carries role=ADMIN.
    await ctx.prisma.user.update({ where: { email }, data: { role: 'USER' } });

    const response = await request(probe)
      .get('/api/admin/probe')
      .set({ authorization: `Bearer ${token}` });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
