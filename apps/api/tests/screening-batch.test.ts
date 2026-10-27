import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LIMITS, screeningBatchUploadResultSchema } from '@aseb/shared';

import { creditService } from '../src/services/credit.service.js';
import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildEmptyPdf, buildTextPdf } from './helpers/pdf.js';
import { buildZip } from './helpers/zip.js';

/**
 * End-to-end coverage of the screening batch upload.
 *
 * Runs against real PostgreSQL semantics (PGlite): text extraction, partial success per
 * file, the ZIP guards wired to the HTTP surface, the credit hold, the job counters and
 * the owner boundary. Queueing (Phase 12) and evidence extraction (Phase 13) are out of
 * scope; the reservation is asserted to stay ACTIVE here.
 */

const CV_LINES = [
  'Andi Pratama',
  'Software Engineer',
  'Pengalaman lima tahun membangun layanan backend dengan Node.js dan PostgreSQL.',
  'Keahlian teknis: TypeScript, Docker, dan pengujian otomatis.',
];

const VALID_JOB = {
  title: 'Backend Engineer',
  description: 'Kami mencari backend engineer berpengalaman dengan Node.js dan PostgreSQL.',
  requirements: [{ text: 'Pengalaman minimal 3 tahun dengan Node.js', weight: 30 }],
} as const;

describe('screening batch upload API', () => {
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

  async function createJob(target: DevSession = session): Promise<string> {
    const response = await request(app)
      .post('/api/screening/jobs')
      .set(bearer(target))
      .send(VALID_JOB);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.job.id as string;
  }

  async function grantCredits(credits: number, target: DevSession = session): Promise<void> {
    await creditService.grantTopUp({
      userId: target.userId,
      credits,
      amountIdr: credits * 1_000,
      paymentTransactionId: `pay-${target.userId}-${credits}`,
    });
  }

  function upload(
    jobId: string,
    files: ReadonlyArray<{ buffer: Buffer; name: string }>,
    target: DevSession = session,
  ) {
    let call = request(app).post(`/api/screening/jobs/${jobId}/candidates`).set(bearer(target));
    for (const file of files) {
      call = call.attach('files', file.buffer, file.name);
    }
    return call;
  }

  function list(jobId: string, query = '', target: DevSession = session) {
    return request(app).get(`/api/screening/jobs/${jobId}/candidates${query}`).set(bearer(target));
  }

  /* ------------------------------------------------------------------ */
  /* Access control                                                      */
  /* ------------------------------------------------------------------ */

  it('requires a session and never touches the database anonymously', async () => {
    const jobId = await createJob();
    const response = await request(app)
      .post(`/api/screening/jobs/${jobId}/candidates`)
      .attach('files', buildTextPdf(CV_LINES), 'cv.pdf');

    expect(response.status).toBe(401);
    expect(await ctx.prisma.screeningCandidate.count()).toBe(0);
  });

  it('hides another user job behind a 404', async () => {
    const jobId = await createJob();
    const other = await signUpDevUser(app);
    await grantCredits(5, other);

    const response = await upload(
      jobId,
      [{ buffer: buildTextPdf(CV_LINES), name: 'cv.pdf' }],
      other,
    );

    expect(response.status).toBe(404);
    expect(await ctx.prisma.screeningCandidate.count()).toBe(0);
  });

  it('rejects an upload with no files', async () => {
    const jobId = await createJob();
    const response = await request(app)
      .post(`/api/screening/jobs/${jobId}/candidates`)
      .set(bearer(session));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  /* ------------------------------------------------------------------ */
  /* Happy path                                                          */
  /* ------------------------------------------------------------------ */

  it('stores a batch as QUEUED and reserves credits for every accepted CV', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const response = await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi-pratama.pdf' },
      { buffer: buildTextPdf(CV_LINES), name: 'budi_santoso.pdf' },
    ]);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const parsed = screeningBatchUploadResultSchema.safeParse(response.body.data.batch);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const batch = response.body.data.batch;
    expect(batch.accepted).toHaveLength(2);
    expect(batch.rejected).toEqual([]);
    expect(batch.acceptedCount).toBe(2);
    expect(
      batch.accepted.map((candidate: { candidateName: string }) => candidate.candidateName),
    ).toEqual(['andi pratama', 'budi santoso']);
    expect(batch.creditsReserved).toBeGreaterThan(0);
    expect(batch.reservationId).toBeTruthy();

    // The job moved to QUEUED and its counters agree with the stored rows.
    expect(batch.job.state).toBe('QUEUED');
    expect(batch.job.totalCandidates).toBe(2);
    expect(batch.job.queuedCandidates).toBe(2);
    expect(batch.job.completedCandidates).toBe(0);
    expect(batch.job.creditsReserved).toBe(batch.creditsReserved);

    const rows = await ctx.prisma.screeningCandidate.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.state).toBe('QUEUED');
    expect(rows[0]?.cvText).toContain('Andi Pratama');
    expect(rows[0]?.textHash).toHaveLength(64);
    expect(rows[0]?.pageCount).toBe(1);

    const reservation = await ctx.prisma.creditReservation.findFirst({
      where: { id: batch.reservationId },
    });
    expect(reservation?.state).toBe('ACTIVE');
    expect(reservation?.reservedCredits).toBe(batch.creditsReserved);
    expect(reservation?.referenceType).toBe('screening_job');
    expect(reservation?.referenceId).toBe(jobId);

    const events = await ctx.prisma.screeningJobEvent.findMany({ where: { jobId } });
    expect(events.filter((event) => event.type === 'CANDIDATE_QUEUED')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'STATE_CHANGED')).toHaveLength(2);
  });

  /* ------------------------------------------------------------------ */
  /* Partial success                                                     */
  /* ------------------------------------------------------------------ */

  it('keeps the accepted CVs when some files fail validation', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const response = await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' },
      { buffer: Buffer.from('bukan pdf sama sekali'), name: 'catatan.pdf' },
    ]);

    expect(response.status).toBe(201);
    const batch = response.body.data.batch;
    expect(batch.acceptedCount).toBe(1);
    expect(batch.rejectedCount).toBe(1);
    expect(batch.rejected[0]).toMatchObject({
      fileName: 'catatan.pdf',
      code: 'UNSUPPORTED_FILE',
    });

    // Only the accepted CV is held: a rejected file must never cost a credit.
    const reservation = await ctx.prisma.creditReservation.findFirst({
      where: { id: batch.reservationId },
    });
    expect(reservation?.reservedCredits).toBe(batch.creditsReserved);
    expect(await ctx.prisma.screeningCandidate.count({ where: { jobId } })).toBe(1);
  });

  it('accepts a ZIP batch and reports the non-PDF entries', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const archive = buildZip([
      { name: 'batch/andi.pdf', data: buildTextPdf(CV_LINES) },
      { name: 'batch/budi.pdf', data: buildTextPdf(CV_LINES) },
      { name: 'batch/rekap.txt', data: 'bukan cv' },
    ]);

    const response = await upload(jobId, [{ buffer: archive, name: 'batch.zip' }]);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const batch = response.body.data.batch;
    expect(batch.accepted.map((candidate: { fileName: string }) => candidate.fileName)).toEqual([
      'andi.pdf',
      'budi.pdf',
    ]);
    expect(batch.rejected).toEqual([
      expect.objectContaining({ fileName: 'rekap.txt', code: 'UNSUPPORTED_FILE' }),
    ]);
  });

  it('reports a scanned PDF as rejected and 400s when nothing survives', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const response = await upload(jobId, [{ buffer: buildEmptyPdf(), name: 'scan.pdf' }]);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.rejected[0]).toMatchObject({
      fileName: 'scan.pdf',
      code: 'TEXT_EXTRACTION_FAILED',
    });
    expect(await ctx.prisma.screeningCandidate.count()).toBe(0);
    expect(await ctx.prisma.creditReservation.count()).toBe(0);
  });

  it('rejects a mixed ZIP plus PDF upload', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const response = await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' },
      { buffer: buildZip([{ name: 'budi.pdf', data: buildTextPdf(CV_LINES) }]), name: 'batch.zip' },
    ]);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  /* ------------------------------------------------------------------ */
  /* ZIP guards and credits                                              */
  /* ------------------------------------------------------------------ */

  it('rejects a zip bomb through the API without writing anything', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const archive = buildZip([
      { name: 'bomb.pdf', data: Buffer.alloc(400_000, 0x41), compress: true },
    ]);
    const response = await upload(jobId, [{ buffer: archive, name: 'batch.zip' }]);

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_FILE');
    expect(await ctx.prisma.screeningCandidate.count()).toBe(0);
    expect(await ctx.prisma.creditReservation.count()).toBe(0);
  });

  it('refuses an unaffordable batch and leaves the job untouched', async () => {
    const jobId = await createJob();

    const response = await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' },
      { buffer: buildTextPdf(CV_LINES), name: 'budi.pdf' },
    ]);

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(await ctx.prisma.screeningCandidate.count()).toBe(0);
    expect(await ctx.prisma.creditReservation.count()).toBe(0);

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('CREATED');
    expect(job?.totalCandidates).toBe(0);
    expect(job?.reservationId).toBeNull();
  });

  it('refuses a second batch for the same job', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const first = await upload(jobId, [{ buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' }]);
    expect(first.status).toBe(201);

    const second = await upload(jobId, [{ buffer: buildTextPdf(CV_LINES), name: 'budi.pdf' }]);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(await ctx.prisma.screeningCandidate.count({ where: { jobId } })).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* Candidate reads                                                     */
  /* ------------------------------------------------------------------ */

  it('lists the batch deterministically and honours pagination', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' },
      { buffer: buildTextPdf(CV_LINES), name: 'budi.pdf' },
      { buffer: buildTextPdf(CV_LINES), name: 'citra.pdf' },
    ]);

    const firstPage = await list(jobId, '?page=1&pageSize=2');
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.candidates.total).toBe(3);
    expect(
      firstPage.body.data.candidates.items.map((item: { fileName: string }) => item.fileName),
    ).toEqual(['andi.pdf', 'budi.pdf']);

    const secondPage = await list(jobId, '?page=2&pageSize=2');
    expect(
      secondPage.body.data.candidates.items.map((item: { fileName: string }) => item.fileName),
    ).toEqual(['citra.pdf']);

    // The extracted text never leaves the server through this endpoint.
    expect(firstPage.body.data.candidates.items[0]).not.toHaveProperty('cvText');
  });

  it('returns 404 when listing candidates of another user job', async () => {
    const jobId = await createJob();
    const other = await signUpDevUser(app);

    const response = await list(jobId, '', other);

    expect(response.status).toBe(404);
  });

  it('never accepts more than the shared batch ceiling', async () => {
    const jobId = await createJob();
    await grantCredits(100);

    const files = Array.from({ length: LIMITS.MAX_SCREENING_CVS + 1 }, (_, index) => ({
      buffer: buildTextPdf(CV_LINES),
      name: `kandidat-${index}.pdf`,
    }));
    const response = await upload(jobId, files);

    // Multer caps the file count before the service sees the request.
    expect([400, 413]).toContain(response.status);
    expect(await ctx.prisma.screeningCandidate.count()).toBe(0);
  });
});
