import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LIMITS, cvAuditResponseSchema } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { AppError } from '../src/utils/errors.js';
import { validatePdfUpload } from '../src/utils/file-validation.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildEmptyPdf, buildTextPdf } from './helpers/pdf.js';

/**
 * End-to-end coverage of the free CV audit.
 *
 * The audit is the first surface the runtime prompt layer reaches, so these tests pin
 * both halves of the contract: the HTTP/file behaviour (guests get 0-credit ephemeral
 * results, signed-in users get a stored, auditable analysis) and the fact that failures
 * never leave partial rows or charge credits.
 */

/** Enough extractable text to pass the "not a scan" check (>= 60 chars, >= 12 words). */
const CV_LINES = [
  'Budi Santoso',
  'Software Engineer',
  'Pengalaman kerja lima tahun membangun aplikasi web untuk layanan publik.',
  'Pendidikan: Universitas Indonesia, Ilmu Komputer.',
  'Keahlian teknis: TypeScript, Node.js, PostgreSQL, dan Docker.',
];

describe('CV audit API', () => {
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
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().reset();
    session = await signUpDevUser(app);
  });

  function upload(buffer: Buffer, fileName = 'cv.pdf') {
    return request(app).post('/api/cv/audit').attach('file', buffer, fileName);
  }

  it('answers a guest with a versioned, ephemeral result and persists no CV data', async () => {
    const response = await upload(buildTextPdf(CV_LINES));

    expect(response.status).toBe(200);
    expect(response.body.data.auditId).toBeNull();

    const parsed = cvAuditResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.data.result).toMatchObject({
      ephemeral: true,
      provider: 'mock',
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
    });
    expect(response.body.data.result.extraction).toMatchObject({
      fileName: 'cv.pdf',
      detectedLanguage: null,
    });
    expect(response.body.data.result.extraction.pageCount).toBeGreaterThanOrEqual(1);
    expect(response.body.data.result.atsScore).toBeGreaterThan(0);

    // The upload is processed in memory: no document, no analysis, no ledger movement.
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect(await ctx.prisma.cvAnalysis.count()).toBe(0);
    expect(await ctx.prisma.creditTransaction.count()).toBe(0);

    // Provider-cost accounting still happens, attributed to nobody and costed at 0 credits.
    const usage = await ctx.prisma.aiUsageRecord.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      userId: null,
      feature: 'FREE_CV_AUDIT',
      creditsCharged: 0,
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
    });
  });

  it('persists a stored audit for a signed-in user, with its prompt version', async () => {
    const response = await upload(buildTextPdf(CV_LINES)).set(bearer(session));

    expect(response.status).toBe(200);
    const auditId = response.body.data.auditId as string;
    expect(auditId).toBeTruthy();
    expect(response.body.data.result.ephemeral).toBe(false);

    const documents = await ctx.prisma.cvDocument.findMany();
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      userId: session.userId,
      kind: 'ORIGINAL',
      isEphemeral: false,
      mimeType: 'application/pdf',
    });
    expect(documents[0]?.textContent).toContain('Budi Santoso');
    expect(documents[0]?.textHash).toHaveLength(64);

    const analyses = await ctx.prisma.cvAnalysis.findMany();
    expect(analyses).toHaveLength(1);
    expect(analyses[0]).toMatchObject({
      id: auditId,
      userId: session.userId,
      documentId: documents[0]?.id,
      kind: 'FREE_AUDIT',
      creditsCharged: 0,
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
    });

    const usage = await ctx.prisma.aiUsageRecord.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      userId: session.userId,
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
    });
    expect(await ctx.prisma.creditTransaction.count()).toBe(0);
  });

  it('exposes a stored audit through history and detail, and hides it from other users', async () => {
    const created = await upload(buildTextPdf(CV_LINES)).set(bearer(session));
    const auditId = created.body.data.auditId as string;

    const history = await request(app).get('/api/cv/history').set(bearer(session));
    expect(history.status).toBe(200);
    expect(history.body.data.analyses).toHaveLength(1);
    expect(history.body.data.analyses[0]).toMatchObject({ id: auditId, kind: 'FREE_AUDIT' });
    expect(history.body.data.totals).toEqual({ analyses: 1, enhancements: 0 });

    const detail = await request(app).get(`/api/cv/analyses/${auditId}`).set(bearer(session));
    expect(detail.status).toBe(200);
    expect(detail.body.data.result.promptVersion).toBe('JOB_SEEKER_AUDIT_V1');

    const stranger = await signUpDevUser(app);
    const forbidden = await request(app).get(`/api/cv/analyses/${auditId}`).set(bearer(stranger));
    expect(forbidden.status).toBe(404);

    const anonymous = await request(app).get('/api/cv/history');
    expect(anonymous.status).toBe(401);
  });

  it('rejects a file that is not a PDF before calling the model', async () => {
    const response = await upload(Buffer.from('ini bukan pdf sama sekali'), 'cv.pdf');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_FILE');
    expect(await ctx.prisma.aiUsageRecord.count()).toBe(0);
  });

  it('rejects a PDF with a misleading extension', async () => {
    const response = await upload(buildTextPdf(CV_LINES), 'cv.docx');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('rejects an empty upload at the validation boundary', () => {
    expect(() =>
      validatePdfUpload({
        originalname: 'cv.pdf',
        mimetype: 'application/pdf',
        size: 0,
        buffer: Buffer.alloc(0),
      }),
    ).toThrowError(AppError);
  });

  it('rejects an oversized upload with FILE_TOO_LARGE', async () => {
    const oversized = Buffer.concat([buildTextPdf(CV_LINES), Buffer.alloc(LIMITS.MAX_PDF_BYTES)]);
    const response = await upload(oversized);

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('reports a scanned/image PDF as TEXT_EXTRACTION_FAILED instead of guessing', async () => {
    const response = await upload(buildEmptyPdf());

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TEXT_EXTRACTION_FAILED');
    expect(await ctx.prisma.aiUsageRecord.count()).toBe(0);
  });

  it('maps a provider failure to AI_PROVIDER_ERROR and leaves no partial rows', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });

    const response = await upload(buildTextPdf(CV_LINES)).set(bearer(session));

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_PROVIDER_ERROR');
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect(await ctx.prisma.cvAnalysis.count()).toBe(0);
  });

  it('maps a provider rate limit to AI_RATE_LIMITED', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ rateLimitNext: 1 });

    const response = await upload(buildTextPdf(CV_LINES));

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_RATE_LIMITED');
  });

  it('throttles anonymous audits per IP', async () => {
    for (let attempt = 0; attempt < LIMITS.GUEST_AUDIT_RATE_LIMIT; attempt += 1) {
      const allowed = await upload(buildTextPdf(CV_LINES));
      expect(allowed.status).toBe(200);
    }

    const blocked = await upload(buildTextPdf(CV_LINES));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
