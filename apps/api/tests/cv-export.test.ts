import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cvExportResponseSchema } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { setPdfRendererForTests, type PdfRenderer } from '../src/providers/pdf/index.js';
import { AppError } from '../src/utils/errors.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildTextPdf } from './helpers/pdf.js';

/**
 * End-to-end coverage of the paid CV PDF export.
 *
 * The renderer is substituted, so these tests never launch Chromium. They pin the money
 * path (reserve -> render -> settle, release on failure) and the artifact bookkeeping
 * (an ENHANCED CvDocument linked through CvEnhancement.resultDocumentId).
 */

const CV_LINES = [
  'Budi Santoso',
  'Software Engineer',
  'Pengalaman kerja lima tahun membangun aplikasi web untuk layanan publik.',
  'Pendidikan: Universitas Indonesia, Ilmu Komputer.',
  'Keahlian teknis: TypeScript, Node.js, PostgreSQL, dan Docker.',
];

const TOP_UP_CREDITS = 50;

describe('CV export API', () => {
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
    setPdfRendererForTests(null);

    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().reset();
    const { pricingService } = await import('../src/services/pricing.service.js');
    pricingService.invalidate();

    session = await signUpDevUser(app);
    await topUp(session, TOP_UP_CREDITS);
  });

  afterEach(() => {
    setPdfRendererForTests(null);
  });

  async function topUp(target: DevSession, credits: number) {
    const { creditService } = await import('../src/services/credit.service.js');
    await creditService.grantTopUp({
      userId: target.userId,
      credits,
      amountIdr: credits * 1_000,
      paymentTransactionId: `pay-${target.userId}-${credits}`,
    });
  }

  async function walletOf(target: DevSession) {
    const { creditService } = await import('../src/services/credit.service.js');
    return creditService.getWallet(target.userId);
  }

  async function createEnhancement(target: DevSession = session): Promise<string> {
    const response = await request(app)
      .post('/api/cv/enhance')
      .set(bearer(target))
      .attach('file', buildTextPdf(CV_LINES), 'cv.pdf')
      .field('options', JSON.stringify({ templateKey: 'ATS_MINIMAL' }));

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.enhancement.id as string;
  }

  function exportRequest(enhancementId: string, target: DevSession = session, body: object = {}) {
    return request(app)
      .post(`/api/cv/enhancements/${enhancementId}/export`)
      .set(bearer(target))
      .send(body);
  }

  function fingerprintOf(contentBase64: string): string {
    const text = Buffer.from(contentBase64, 'base64').toString('latin1');
    return /htmlSha256=([0-9a-f]+)/.exec(text)?.[1] ?? '';
  }

  it('requires authentication', async () => {
    const response = await request(app).post('/api/cv/enhancements/unknown/export').send({});

    expect(response.status).toBe(401);
    expect(await ctx.prisma.cvDocument.count()).toBe(0);
  });

  it('refuses to export another user’s enhancement', async () => {
    const enhancementId = await createEnhancement();
    const stranger = await signUpDevUser(app);

    const response = await exportRequest(enhancementId, stranger);

    expect(response.status).toBe(404);
    expect((await walletOf(stranger)).balance).toBe(0);
  });

  it('rejects an export the user cannot afford, without rendering', async () => {
    const poor = await signUpDevUser(app);
    await topUp(poor, 5);
    const enhancementId = await createEnhancement(poor);
    expect((await walletOf(poor)).available).toBe(0);

    const response = await exportRequest(enhancementId, poor);

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(response.body.error.details).toMatchObject({ required: 1, available: 0 });
    expect(await ctx.prisma.cvDocument.count({ where: { kind: 'ENHANCED' } })).toBe(0);
  });

  it('renders the PDF, charges one credit and links the generated document', async () => {
    const enhancementId = await createEnhancement();

    const response = await exportRequest(enhancementId);

    expect(response.status).toBe(201);
    const parsed = cvExportResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const { export: result } = response.body.data;
    expect(result.templateKey).toBe('ATS_MINIMAL');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.creditsCharged).toBe(1);
    expect(result.pageCount).toBe(1);
    expect(result.fileName).toBe('Budi_Santoso-ats_minimal.pdf');

    const bytes = Buffer.from(result.contentBase64, 'base64');
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.sizeBytes).toBe(bytes.byteLength);

    const documents = await ctx.prisma.cvDocument.findMany({ where: { kind: 'ENHANCED' } });
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      userId: session.userId,
      kind: 'ENHANCED',
      fileName: 'Budi_Santoso-ats_minimal.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
    });
    expect(documents[0]?.textContent).toContain('Budi Santoso');
    expect(documents[0]?.textHash).toHaveLength(64);

    const enhancement = await ctx.prisma.cvEnhancement.findUnique({
      where: { id: enhancementId },
    });
    expect(enhancement?.resultDocumentId).toBe(documents[0]?.id);

    const usage = await ctx.prisma.creditTransaction.findMany({ where: { type: 'USAGE' } });
    // One row for the enhancement, one for the export.
    expect(usage).toHaveLength(2);
    expect(usage.map((row) => row.feature)).toEqual(
      expect.arrayContaining(['CV_ENHANCEMENT', 'CV_PDF_EXPORT']),
    );
    const exportCharge = usage.find((row) => row.feature === 'CV_PDF_EXPORT');
    expect(exportCharge?.amount).toBe(-1);

    const after = await walletOf(session);
    expect(after.balance).toBe(TOP_UP_CREDITS - 5 - 1);
    expect(after.reserved).toBe(0);
  });

  it('lets the user choose a different template and records it', async () => {
    const enhancementId = await createEnhancement();

    const first = await exportRequest(enhancementId, session, { templateKey: 'ATS_MINIMAL' });
    const second = await exportRequest(enhancementId, session, { templateKey: 'MODERN' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.export.templateKey).toBe('MODERN');
    expect(second.body.data.export.fileName).toBe('Budi_Santoso-modern.pdf');

    // Different HTML in, different fingerprint out: the layout really changed.
    expect(fingerprintOf(second.body.data.export.contentBase64)).not.toBe(
      fingerprintOf(first.body.data.export.contentBase64),
    );

    const enhancement = await ctx.prisma.cvEnhancement.findUnique({
      where: { id: enhancementId },
    });
    expect(enhancement?.templateKey).toBe('MODERN');
  });

  it('releases the reservation when the renderer fails', async () => {
    const enhancementId = await createEnhancement();
    const before = await walletOf(session);

    const brokenRenderer: PdfRenderer = {
      name: 'broken',
      render: async () => {
        throw AppError.upstream('renderer exploded');
      },
    };
    setPdfRendererForTests(brokenRenderer);

    const response = await exportRequest(enhancementId);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('UPSTREAM_UNAVAILABLE');

    const reservations = await ctx.prisma.creditReservation.findMany({
      where: { feature: 'CV_PDF_EXPORT' },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.state).toBe('RELEASED');

    const after = await walletOf(session);
    expect(after.balance).toBe(before.balance);
    expect(after.reserved).toBe(0);
    expect(await ctx.prisma.cvDocument.count({ where: { kind: 'ENHANCED' } })).toBe(0);
  });

  it('refuses to export an enhancement that did not complete', async () => {
    const { getMockProvider } = await import('../src/providers/ai/index.js');
    getMockProvider().configure({ failNext: 1 });

    const failed = await request(app)
      .post('/api/cv/enhance')
      .set(bearer(session))
      .attach('file', buildTextPdf(CV_LINES), 'cv.pdf')
      .field('options', JSON.stringify({}));

    expect(failed.status).toBe(502);
    const row = await ctx.prisma.cvEnhancement.findFirst();
    expect(row?.status).toBe('FAILED');

    const response = await exportRequest(row?.id ?? 'missing');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects an unknown template key as a validation error', async () => {
    const enhancementId = await createEnhancement();

    const response = await exportRequest(enhancementId, session, { templateKey: 'FANCY' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect((await walletOf(session)).balance).toBe(TOP_UP_CREDITS - 5);
  });
});
