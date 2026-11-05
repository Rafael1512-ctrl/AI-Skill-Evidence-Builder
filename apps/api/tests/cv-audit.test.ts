import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  LIMITS,
  cvAnalysisDetailSchema,
  cvAuditJobResponseSchema,
  cvHistoryResponseSchema,
} from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import type { InProcessCvProcessingQueue } from '../src/queues/cv-processing.queue.js';
import { AppError } from '../src/utils/errors.js';
import { validatePdfUpload } from '../src/utils/file-validation.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildEmptyPdf, buildTextPdf } from './helpers/pdf.js';

/**
 * End-to-end coverage of the authenticated, asynchronous CV audit.
 *
 * POST persists a durable job and returns 202. The test worker then completes it, and the
 * status endpoint is the same surface a refreshed browser uses to reconnect.
 */
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
  let queue: InProcessCvProcessingQueue;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    const { InProcessCvProcessingQueue, setCvProcessingQueue } =
      await import('../src/queues/cv-processing.queue.js');
    const { startCvWorker } = await import('../src/workers/cv.worker.js');
    queue = new InProcessCvProcessingQueue({ concurrency: 1, attempts: 1, backoffMs: 5 });
    setCvProcessingQueue(queue);
    await startCvWorker();
    ({ app } = await import('../src/server.test-helper.js'));
  });

  afterAll(async () => {
    const { setCvProcessingQueue } = await import('../src/queues/cv-processing.queue.js');
    const { stopCvWorker } = await import('../src/workers/cv.worker.js');
    await stopCvWorker();
    setCvProcessingQueue(null);
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
    return request(app).post('/api/cv/audit').set(bearer(session)).attach('file', buffer, fileName);
  }

  function uploadAnonymous(buffer: Buffer, fileName = 'cv.pdf') {
    return request(app).post('/api/cv/audit').attach('file', buffer, fileName);
  }

  async function waitForAudit(auditId: string) {
    await queue.waitForIdle();
    return request(app).get(`/api/cv/audits/${auditId}`).set(bearer(session));
  }

  async function auditToCompletion(buffer: Buffer, fileName = 'cv.pdf') {
    const accepted = await upload(buffer, fileName);
    expect(accepted.status).toBe(202);
    return waitForAudit(accepted.body.data.audit.auditId as string);
  }

  async function topUp(credits = 10) {
    const { creditService } = await import('../src/services/credit.service.js');
    await creditService.grantTopUp({
      userId: session.userId,
      credits,
      amountIdr: credits * 1_000,
      paymentTransactionId: `audit-test-${session.userId}-${Math.random()}`,
    });
  }

  it('requires a signed-in account for both audit usage and uploads', async () => {
    const usage = await request(app).get('/api/cv/audit/usage');
    expect(usage.status).toBe(401);
    expect(usage.body.error.code).toBe('AUTHENTICATION_REQUIRED');

    const response = await uploadAnonymous(buildTextPdf(CV_LINES));
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect(await ctx.prisma.cvAuditJob.count()).toBe(0);
  });

  it('reports five free audits for a fresh account', async () => {
    const response = await request(app).get('/api/cv/audit/usage').set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      freeAuditsLimit: LIMITS.FREE_CV_AUDITS_PER_DAY,
      freeAuditsUsed: 0,
      freeAuditsRemaining: LIMITS.FREE_CV_AUDITS_PER_DAY,
      paidAuditCredits: 2,
      availableCredits: 0,
    });
    expect(new Date(response.body.data.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('uses Jakarta midnight rather than the server timezone for the quota window', async () => {
    const { auditDayWindow } = await import('../src/services/cv-audit.service.js');
    const beforeMidnight = auditDayWindow(new Date('2026-11-04T16:59:59.999Z'));
    const atMidnight = auditDayWindow(new Date('2026-11-04T17:00:00.000Z'));

    expect(beforeMidnight.dateKey).toBe('2026-11-04');
    expect(beforeMidnight.resetsAt).toBe('2026-11-04T17:00:00.000Z');
    expect(atMidnight.dateKey).toBe('2026-11-05');
    expect(atMidnight.resetsAt).toBe('2026-11-05T17:00:00.000Z');
  });

  it('returns a durable QUEUED job before background processing completes', async () => {
    const accepted = await upload(buildTextPdf(CV_LINES));

    expect(accepted.status).toBe(202);
    expect(accepted.body.data.audit).toMatchObject({
      status: 'QUEUED',
      result: null,
      billing: null,
    });
    const parsed = cvAuditJobResponseSchema.safeParse(accepted.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const auditId = accepted.body.data.audit.auditId as string;
    const completed = await waitForAudit(auditId);
    expect(completed.status).toBe(200);
    expect(completed.body.data.audit.status).toBe('COMPLETED');
    expect(cvAuditJobResponseSchema.safeParse(completed.body.data).success).toBe(true);
  });

  it('persists a stored audit for a signed-in user, with its prompt version', async () => {
    const response = await auditToCompletion(buildTextPdf(CV_LINES));

    expect(response.status).toBe(200);
    const audit = response.body.data.audit;
    expect(audit.analysisId).toBeTruthy();
    expect(audit.result.ephemeral).toBe(false);
    expect(audit.billing).toMatchObject({
      mode: 'FREE',
      creditsCharged: 0,
      freeAuditsUsed: 1,
      freeAuditsRemaining: 4,
    });

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
      id: audit.analysisId,
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
      feature: 'FREE_CV_AUDIT',
      creditsCharged: 0,
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
    });
    expect(await ctx.prisma.creditReservation.count({ where: { state: 'SETTLED' } })).toBe(1);
  });

  it('exposes a stored audit through history and detail, and hides it from other users', async () => {
    const created = await auditToCompletion(buildTextPdf(CV_LINES));
    const auditId = created.body.data.audit.analysisId as string;

    const history = await request(app).get('/api/cv/history').set(bearer(session));
    expect(history.status).toBe(200);
    expect(history.body.data.analyses).toHaveLength(1);
    expect(history.body.data.analyses[0]).toMatchObject({
      id: auditId,
      kind: 'FREE_AUDIT',
      documentId: expect.any(String),
      fileName: 'cv.pdf',
    });
    expect(history.body.data.totals).toEqual({ analyses: 1, enhancements: 0 });
    expect(cvHistoryResponseSchema.safeParse(history.body.data).success).toBe(true);

    const detail = await request(app).get(`/api/cv/analyses/${auditId}`).set(bearer(session));
    expect(detail.status).toBe(200);
    expect(detail.body.data.result.promptVersion).toBe('JOB_SEEKER_AUDIT_V1');
    expect(cvAnalysisDetailSchema.safeParse(detail.body.data).success).toBe(true);

    const stranger = await signUpDevUser(app);
    const strangerHistory = await request(app).get('/api/cv/history').set(bearer(stranger));
    expect(strangerHistory.status).toBe(200);
    expect(strangerHistory.body.data.analyses).toEqual([]);

    const forbiddenJob = await request(app)
      .get(`/api/cv/audits/${created.body.data.audit.auditId}`)
      .set(bearer(stranger));
    expect(forbiddenJob.status).toBe(404);

    const forbidden = await request(app).get(`/api/cv/analyses/${auditId}`).set(bearer(stranger));
    expect(forbidden.status).toBe(404);
  });

  it('rejects a file that is not a PDF before creating a job', async () => {
    const response = await upload(Buffer.from('ini bukan pdf sama sekali'), 'cv.pdf');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_FILE');
    expect(await ctx.prisma.cvAuditJob.count()).toBe(0);
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
    expect(await ctx.prisma.cvAuditJob.count()).toBe(0);
    expect(await ctx.prisma.aiUsageRecord.count()).toBe(0);
  });

  it('stores a failed job with AI_PROVIDER_ERROR and no analysis', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });

    const accepted = await upload(buildTextPdf(CV_LINES));
    expect(accepted.status).toBe(202);
    const response = await waitForAudit(accepted.body.data.audit.auditId as string);

    expect(response.status).toBe(200);
    expect(response.body.data.audit.status).toBe('FAILED');
    expect(response.body.data.audit.failure.code).toBe('AI_PROVIDER_ERROR');
    expect(await ctx.prisma.cvDocument.count()).toBe(1);
    expect(await ctx.prisma.cvAuditJob.count()).toBe(1);
    expect(await ctx.prisma.cvAnalysis.count()).toBe(0);
  });

  it('stores AI_RATE_LIMITED on the job', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ rateLimitNext: 1 });

    const accepted = await upload(buildTextPdf(CV_LINES));
    expect(accepted.status).toBe(202);
    const response = await waitForAudit(accepted.body.data.audit.auditId as string);

    expect(response.body.data.audit.status).toBe('FAILED');
    expect(response.body.data.audit.failure.code).toBe('AI_RATE_LIMITED');
  });

  it('allows five free audits, then charges the configured additional-audit price', async () => {
    await topUp();

    for (let attempt = 0; attempt < LIMITS.FREE_CV_AUDITS_PER_DAY; attempt += 1) {
      const allowed = await auditToCompletion(buildTextPdf(CV_LINES));
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.audit.billing.mode).toBe('FREE');
    }

    const paid = await auditToCompletion(buildTextPdf(CV_LINES));
    expect(paid.status).toBe(200);
    expect(paid.body.data.audit.billing).toMatchObject({
      mode: 'PAID',
      creditsCharged: 2,
      freeAuditsUsed: 5,
      freeAuditsRemaining: 0,
      paidAuditCredits: 2,
    });

    const analyses = await ctx.prisma.cvAnalysis.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(analyses).toHaveLength(6);
    expect(analyses.slice(0, 5).every((analysis) => analysis.kind === 'FREE_AUDIT')).toBe(true);
    expect(analyses[5]).toMatchObject({
      kind: 'DEEP_ANALYSIS',
      creditsCharged: 2,
    });

    const usage = await request(app).get('/api/cv/audit/usage').set(bearer(session));
    expect(usage.body.data).toMatchObject({
      freeAuditsRemaining: 0,
      availableCredits: 8,
      paidAuditCredits: 2,
    });

    const charge = await ctx.prisma.creditTransaction.findFirst({
      where: { feature: 'CV_DEEP_ANALYSIS', type: 'USAGE' },
    });
    expect(charge).toMatchObject({ amount: -2, balanceAfter: 8 });
  });

  it('returns INSUFFICIENT_CREDITS instead of starting a sixth audit without credits', async () => {
    for (let attempt = 0; attempt < LIMITS.FREE_CV_AUDITS_PER_DAY; attempt += 1) {
      const allowed = await auditToCompletion(buildTextPdf(CV_LINES));
      expect(allowed.status).toBe(200);
    }

    const blocked = await upload(buildTextPdf(CV_LINES));
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(await ctx.prisma.cvDocument.count()).toBe(5);
    expect(await ctx.prisma.cvAuditJob.count()).toBe(5);
    expect(await ctx.prisma.cvAnalysis.count()).toBe(5);
    expect(
      await ctx.prisma.creditReservation.count({ where: { feature: 'CV_DEEP_ANALYSIS' } }),
    ).toBe(0);
  });

  it('releases a paid audit hold without charging when the worker fails', async () => {
    await topUp(5);
    for (let attempt = 0; attempt < LIMITS.FREE_CV_AUDITS_PER_DAY; attempt += 1) {
      const allowed = await auditToCompletion(buildTextPdf(CV_LINES));
      expect(allowed.status).toBe(200);
    }

    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });
    const accepted = await upload(buildTextPdf(CV_LINES));
    const failed = await waitForAudit(accepted.body.data.audit.auditId as string);
    expect(failed.body.data.audit.status).toBe('FAILED');
    expect(failed.body.data.audit.failure.code).toBe('AI_PROVIDER_ERROR');

    const { creditService } = await import('../src/services/credit.service.js');
    const wallet = await creditService.getWallet(session.userId);
    expect(wallet).toMatchObject({ balance: 5, reserved: 0, available: 5 });

    const paidReservation = await ctx.prisma.creditReservation.findFirstOrThrow({
      where: { feature: 'CV_DEEP_ANALYSIS' },
    });
    expect(paidReservation.state).toBe('RELEASED');
    expect(await ctx.prisma.cvAnalysis.count()).toBe(5);
  });

  it('resets the free quota at the start of the next Jakarta day', async () => {
    const first = await auditToCompletion(buildTextPdf(CV_LINES));
    expect(first.status).toBe(200);

    const reservation = await ctx.prisma.creditReservation.findFirstOrThrow({
      where: { feature: 'FREE_CV_AUDIT' },
    });
    await ctx.prisma.creditReservation.update({
      where: { id: reservation.id },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1_000) },
    });

    const usage = await request(app).get('/api/cv/audit/usage').set(bearer(session));
    expect(usage.body.data.freeAuditsRemaining).toBe(LIMITS.FREE_CV_AUDITS_PER_DAY);

    const second = await auditToCompletion(buildTextPdf(CV_LINES));
    expect(second.body.data.audit.billing.mode).toBe('FREE');
  });

  it('does not consume a free slot when the worker fails', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });

    const accepted = await upload(buildTextPdf(CV_LINES));
    const failed = await waitForAudit(accepted.body.data.audit.auditId as string);
    expect(failed.body.data.audit.status).toBe('FAILED');

    const usage = await request(app).get('/api/cv/audit/usage').set(bearer(session));
    expect(usage.body.data.freeAuditsRemaining).toBe(LIMITS.FREE_CV_AUDITS_PER_DAY);

    const reservation = await ctx.prisma.creditReservation.findFirstOrThrow({
      where: { feature: 'FREE_CV_AUDIT' },
    });
    expect(reservation.state).toBe('RELEASED');

    const retry = await auditToCompletion(buildTextPdf(CV_LINES));
    expect(retry.body.data.audit.billing.mode).toBe('FREE');
  });
});
