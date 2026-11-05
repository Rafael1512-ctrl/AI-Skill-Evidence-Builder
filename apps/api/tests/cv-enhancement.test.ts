import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cvEnhancementResponseSchema, cvHistoryResponseSchema } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import type { InProcessCvProcessingQueue } from '../src/queues/cv-processing.queue.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildEmptyPdf, buildTextPdf } from './helpers/pdf.js';

/**
 * End-to-end coverage of the asynchronous paid CV enhancer.
 *
 * POST persists a PENDING enhancement and returns 202. The worker then performs the model
 * call and stores the result. Credits stay reserved until success and are released on failure.
 */
const CV_LINES = [
  'Budi Santoso',
  'Software Engineer',
  'Pengalaman kerja lima tahun membangun aplikasi web untuk layanan publik.',
  'Pendidikan: Universitas Indonesia, Ilmu Komputer.',
  'Keahlian teknis: TypeScript, Node.js, PostgreSQL, dan Docker.',
];

const TOP_UP_CREDITS = 50;

describe('CV enhancement API', () => {
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
    const { pricingService } = await import('../src/services/pricing.service.js');
    pricingService.invalidate();

    session = await signUpDevUser(app);

    const { creditService } = await import('../src/services/credit.service.js');
    await creditService.grantTopUp({
      userId: session.userId,
      credits: TOP_UP_CREDITS,
      amountIdr: TOP_UP_CREDITS * 1_000,
      paymentTransactionId: `pay-${session.userId}`,
    });
  });

  function enhance(
    body: Buffer,
    options: Record<string, unknown> = {},
    target: DevSession = session,
    fileName = 'cv.pdf',
  ) {
    return request(app)
      .post('/api/cv/enhance')
      .set(bearer(target))
      .attach('file', body, fileName)
      .field('options', JSON.stringify(options));
  }

  async function waitForEnhancement(enhancementId: string) {
    await queue.waitForIdle();
    return request(app).get(`/api/cv/enhancements/${enhancementId}`).set(bearer(session));
  }

  async function enhanceToCompletion(
    body: Buffer,
    options: Record<string, unknown> = {},
    fileName = 'cv.pdf',
  ) {
    const accepted = await enhance(body, options, session, fileName);
    expect(accepted.status).toBe(202);
    return waitForEnhancement(accepted.body.data.enhancement.id as string);
  }

  async function wallet() {
    const { creditService } = await import('../src/services/credit.service.js');
    return creditService.getWallet(session.userId);
  }

  it('requires authentication and charges nothing for an anonymous request', async () => {
    const response = await request(app)
      .post('/api/cv/enhance')
      .attach('file', buildTextPdf(CV_LINES), 'cv.pdf');

    expect(response.status).toBe(401);
    expect(await ctx.prisma.cvEnhancement.count()).toBe(0);
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect(await ctx.prisma.creditTransaction.count({ where: { type: 'USAGE' } })).toBe(0);
  });

  it('rejects a user who cannot afford the enhancement without creating any rows', async () => {
    const { creditService } = await import('../src/services/credit.service.js');
    const poor = await signUpDevUser(app);

    const response = await enhance(buildTextPdf(CV_LINES), {}, poor);

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(response.body.error.details).toMatchObject({ required: 5, available: 0 });

    expect(await ctx.prisma.cvEnhancement.count()).toBe(0);
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect((await creditService.getWallet(poor.userId)).balance).toBe(0);
  });

  it('returns a durable PENDING enhancement before the worker completes it', async () => {
    const accepted = await enhance(buildTextPdf(CV_LINES));

    expect(accepted.status).toBe(202);
    expect(accepted.body.data.enhancement).toMatchObject({
      status: 'PENDING',
      document: null,
      creditsCharged: 0,
    });
    expect(cvEnhancementResponseSchema.safeParse(accepted.body.data).success).toBe(true);

    const completed = await waitForEnhancement(accepted.body.data.enhancement.id as string);
    expect(completed.body.data.enhancement.status).toBe('COMPLETED');
  });

  it('reserves, settles and stores the enhanced document with its prompt version', async () => {
    const response = await enhanceToCompletion(buildTextPdf(CV_LINES), {
      targetPosition: 'Backend Engineer',
      targetCareer: 'Teknologi',
      linkedinUrl: 'https://linkedin.com/in/budi',
      additionalNotes: 'Tolong tonjolkan pengalaman Node.js.',
    });

    expect(response.status).toBe(200);
    const parsed = cvEnhancementResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const { enhancement } = response.body.data;
    expect(enhancement.status).toBe('COMPLETED');
    expect(enhancement.creditsCharged).toBe(5);
    expect(enhancement.templateKey).toBe('ATS_MINIMAL');
    expect(enhancement.promptVersion).toBe('JOB_SEEKER_ENHANCE_V1');
    expect(enhancement.document.professionalSummary).toEqual(expect.any(String));
    expect(enhancement.document.headline).toBe('Backend Engineer');
    expect(enhancement.document.contact.linkedinUrl).toBe('https://linkedin.com/in/budi');
    expect(enhancement.originalText).toContain('Budi Santoso');

    const documents = await ctx.prisma.cvDocument.findMany();
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      userId: session.userId,
      kind: 'ORIGINAL',
      isEphemeral: false,
    });

    const rows = await ctx.prisma.cvEnhancement.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: session.userId,
      status: 'COMPLETED',
      templateKey: 'ATS_MINIMAL',
      promptVersion: 'JOB_SEEKER_ENHANCE_V1',
      creditsCharged: 5,
      sourceDocumentId: documents[0]?.id,
    });

    const reservations = await ctx.prisma.creditReservation.findMany();
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.state).toBe('SETTLED');
    expect(reservations[0]?.reservedCredits).toBe(5);

    const usage = await ctx.prisma.aiUsageRecord.findMany();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      userId: session.userId,
      feature: 'CV_ENHANCEMENT',
      creditsCharged: 5,
      promptVersion: 'JOB_SEEKER_ENHANCE_V1',
      success: true,
      cvEnhancementId: rows[0]?.id,
    });

    const after = await wallet();
    expect(after.balance).toBe(TOP_UP_CREDITS - 5);
    expect(after.reserved).toBe(0);
    expect(after.available).toBe(TOP_UP_CREDITS - 5);

    const ledger = await ctx.prisma.creditTransaction.findMany({ where: { type: 'USAGE' } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: -5, feature: 'CV_ENHANCEMENT' });
  });

  it('releases the reservation and marks FAILED when the worker provider call fails', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });

    const accepted = await enhance(buildTextPdf(CV_LINES));
    expect(accepted.status).toBe(202);
    const response = await waitForEnhancement(accepted.body.data.enhancement.id as string);

    expect(response.status).toBe(200);
    expect(response.body.data.enhancement.status).toBe('FAILED');
    expect(response.body.data.enhancement.failureReason).toMatch(/AI|provider|gagal/i);

    const rows = await ctx.prisma.cvEnhancement.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.creditsCharged).toBe(0);
    expect(rows[0]?.promptVersion).toBe('JOB_SEEKER_ENHANCE_V1');

    const reservations = await ctx.prisma.creditReservation.findMany();
    expect(reservations[0]?.state).toBe('RELEASED');

    const after = await wallet();
    expect(after.balance).toBe(TOP_UP_CREDITS);
    expect(after.reserved).toBe(0);
    expect(await ctx.prisma.aiUsageRecord.count()).toBe(0);
  });

  it('rejects a PDF with no extractable text before creating the job', async () => {
    const response = await enhance(buildEmptyPdf());

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('TEXT_EXTRACTION_FAILED');
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect(await ctx.prisma.cvEnhancement.count()).toBe(0);
    expect((await wallet()).balance).toBe(TOP_UP_CREDITS);
  });

  it('rejects a malformed options field as a validation error', async () => {
    const response = await request(app)
      .post('/api/cv/enhance')
      .set(bearer(session))
      .attach('file', buildTextPdf(CV_LINES), 'cv.pdf')
      .field('options', '{not-json');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await ctx.prisma.cvEnhancement.count()).toBe(0);
    expect((await wallet()).balance).toBe(TOP_UP_CREDITS);
  });

  it('stores the consent flag and defaults it to off', async () => {
    await request(app)
      .patch('/api/profile')
      .set(bearer(session))
      .send({ fullName: 'Nama Dari Profil', headline: 'Headline Profil' });

    const withConsent = await enhanceToCompletion(buildTextPdf(CV_LINES), {
      useProfileContext: true,
    });
    expect(withConsent.status).toBe(200);
    expect(withConsent.body.data.enhancement.options.useProfileContext).toBe(true);

    await ctx.db.reset();
    resetRateLimits();
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().reset();
    session = await signUpDevUser(app);
    const { creditService } = await import('../src/services/credit.service.js');
    await creditService.grantTopUp({
      userId: session.userId,
      credits: TOP_UP_CREDITS,
      amountIdr: TOP_UP_CREDITS * 1_000,
      paymentTransactionId: `pay-${session.userId}`,
    });

    const withoutConsent = await enhanceToCompletion(buildTextPdf(CV_LINES));
    expect(withoutConsent.status).toBe(200);
    expect(withoutConsent.body.data.enhancement.options.useProfileContext).toBe(false);
  });

  it('surfaces the enhancement in history and serves an owner-scoped detail', async () => {
    const created = await enhanceToCompletion(buildTextPdf(CV_LINES), {
      targetPosition: 'Backend Engineer',
    });
    const enhancementId = created.body.data.enhancement.id as string;

    const history = await request(app).get('/api/cv/history').set(bearer(session));
    expect(history.status).toBe(200);
    expect(history.body.data.enhancements).toHaveLength(1);
    expect(history.body.data.enhancements[0]).toMatchObject({
      id: enhancementId,
      status: 'COMPLETED',
      fileName: 'cv.pdf',
      creditsCharged: 5,
      promptVersion: 'JOB_SEEKER_ENHANCE_V1',
    });
    expect(cvHistoryResponseSchema.safeParse(history.body.data).success).toBe(true);

    const detail = await request(app)
      .get(`/api/cv/enhancements/${enhancementId}`)
      .set(bearer(session));
    expect(detail.status).toBe(200);
    expect(cvEnhancementResponseSchema.safeParse(detail.body.data).success).toBe(true);
    expect(detail.body.data.enhancement.originalText).toContain('Budi Santoso');
    expect(detail.body.data.enhancement.fileName).toBe('cv.pdf');

    const stranger = await signUpDevUser(app);
    const forbidden = await request(app)
      .get(`/api/cv/enhancements/${enhancementId}`)
      .set(bearer(stranger));
    expect(forbidden.status).toBe(404);
  });

  it('keeps a failed enhancement readable in history, without a result or a charge', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });
    await enhance(buildTextPdf(CV_LINES));
    await queue.waitForIdle();

    const history = await request(app).get('/api/cv/history').set(bearer(session));
    const [row] = history.body.data.enhancements;
    expect(row).toMatchObject({ status: 'FAILED', fileName: 'cv.pdf', creditsCharged: 0 });

    const detail = await request(app).get(`/api/cv/enhancements/${row.id}`).set(bearer(session));
    expect(detail.status).toBe(200);
    expect(detail.body.data.enhancement).toMatchObject({ status: 'FAILED', document: null });
    expect(detail.body.data.enhancement.failureReason).toEqual(expect.any(String));
  });

  it('still opens an enhancement after its source CV is deleted', async () => {
    const created = await enhanceToCompletion(buildTextPdf(CV_LINES));
    const { id, sourceDocumentId } = created.body.data.enhancement;

    const removed = await request(app)
      .delete(`/api/cv/documents/${sourceDocumentId}`)
      .set(bearer(session));
    expect(removed.status).toBe(204);

    const detail = await request(app).get(`/api/cv/enhancements/${id}`).set(bearer(session));
    expect(detail.status).toBe(200);
    expect(detail.body.data.enhancement.originalText).toBe('');
    expect(detail.body.data.enhancement.fileName).toBe('cv.pdf');
    expect(detail.body.data.enhancement.document).not.toBeNull();
  });
});
