import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../src/server.test-helper.js';
import { resetRateLimits } from '../src/middleware/rate-limit.js';

/**
 * HTTP-layer verification for Phase 2: the application boots, exposes a health
 * endpoint, preserves the legacy CV route, and answers errors in the documented
 * envelope. No database is required for these assertions.
 */
describe('API application', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('exposes service metadata at the root', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('AI Skill Evidence Builder API');
  });

  it('reports health without requiring a database', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'ok',
      database: 'not_configured',
      aiProvider: 'mock',
      queue: 'in-process',
    });
    expect(Array.isArray(response.body.data.warnings)).toBe(true);
  });

  it('preserves the legacy GET /api/cv/test route', async () => {
    const response = await request(app).get('/api/cv/test');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
  });

  it('returns a machine-readable error envelope for unknown routes', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('echoes a request id back to the caller', async () => {
    const response = await request(app).get('/api/health').set('x-request-id', 'test-request-id');

    expect(response.headers['x-request-id']).toBe('test-request-id');
  });

  it('requires authentication for the credit wallet', async () => {
    const response = await request(app).get('/api/credits/wallet');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a malformed sign-in payload with a validation error', async () => {
    const response = await request(app)
      .post('/api/auth/dev/sign-in')
      .send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a CV audit without a file', async () => {
    const response = await request(app).post('/api/cv/audit');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not reflect CORS origins that are not allowlisted', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the configured frontend origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
