import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LIMITS, screeningBatchUploadResultSchema } from '@aseb/shared';

import { setScreeningQueue } from '../src/queues/index.js';
import type { ScreeningQueue } from '../src/queues/types.js';
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
  let enqueued: Array<{ jobId: string; candidateIds: readonly string[] }>;
  let brokerDown: boolean;

  /** Records what reaches the queue, so a test can prove that upload alone queues nothing. */
  const recordingQueue: ScreeningQueue = {
    driver: 'in-process',
    enqueueCandidates: async (input) => {
      if (brokerDown) throw new Error('broker down');
      enqueued.push(input);
    },
    start: async () => undefined,
    stop: async () => undefined,
    waitForIdle: async () => undefined,
  };

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
    enqueued = [];
    brokerDown = false;
    setScreeningQueue(recordingQueue);
    session = await signUpDevUser(app);
  });

  afterEach(() => {
    setScreeningQueue(null);
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

  function start(jobId: string, target: DevSession = session) {
    return request(app).post(`/api/screening/jobs/${jobId}/start`).set(bearer(target));
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

  it('stores an uploaded batch without running it or holding credits', async () => {
    const jobId = await createJob();

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
    expect(batch.creditsReserved).toBe(0);
    expect(batch.reservationId).toBeNull();

    // The job waits for the recruiter, and its counters agree with the stored rows.
    expect(batch.job.state).toBe('CREATED');
    expect(batch.job.totalCandidates).toBe(2);
    expect(batch.job.queuedCandidates).toBe(2);
    expect(batch.job.completedCandidates).toBe(0);
    expect(batch.job.creditsReserved).toBe(0);

    const rows = await ctx.prisma.screeningCandidate.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.state).toBe('QUEUED');
    expect(rows[0]?.cvText).toContain('Andi Pratama');
    expect(rows[0]?.textHash).toHaveLength(64);
    expect(rows[0]?.pageCount).toBe(1);

    expect(enqueued).toEqual([]);
    expect(await ctx.prisma.creditReservation.count()).toBe(0);

    const events = await ctx.prisma.screeningJobEvent.findMany({ where: { jobId } });
    expect(events.filter((event) => event.type === 'CANDIDATE_QUEUED')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'STATE_CHANGED')).toHaveLength(2);
  });

  /* ------------------------------------------------------------------ */
  /* Starting a batch                                                    */
  /* ------------------------------------------------------------------ */

  it('holds credits and queues every candidate when the recruiter starts', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' },
      { buffer: buildTextPdf(CV_LINES), name: 'budi.pdf' },
    ]);

    const response = await start(jobId);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data.job.state).toBe('QUEUED');
    expect(response.body.data.job.creditsReserved).toBeGreaterThan(0);

    const rows = await ctx.prisma.screeningCandidate.findMany({ where: { jobId } });
    expect(enqueued).toHaveLength(1);
    expect([...(enqueued[0]?.candidateIds ?? [])].sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );

    const reservation = await ctx.prisma.creditReservation.findFirst();
    expect(reservation).toMatchObject({
      state: 'ACTIVE',
      feature: 'HRD_SCREEN_PER_CV',
      referenceType: 'screening_job',
      referenceId: jobId,
      reservedCredits: response.body.data.job.creditsReserved,
    });
  });

  it('holds credits only once when a batch is started twice', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await upload(jobId, [{ buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' }]);

    expect((await start(jobId)).status).toBe(201);
    const second = await start(jobId);

    expect(second.status).toBe(409);
    expect(enqueued).toHaveLength(1);
    expect(await ctx.prisma.creditReservation.count()).toBe(1);
  });

  it('refuses to start a job that has no candidates', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    const response = await start(jobId);

    expect(response.status).toBe(409);
    expect(await ctx.prisma.creditReservation.count()).toBe(0);
  });

  it('hides a batch from another account', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await upload(jobId, [{ buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' }]);

    const stranger = await signUpDevUser(app);
    const response = await start(jobId, stranger);

    expect(response.status).toBe(404);
    expect(enqueued).toEqual([]);
  });

  it('returns the hold and lets the recruiter retry when the queue is down', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await upload(jobId, [{ buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' }]);

    brokerDown = true;
    const failed = await start(jobId);

    expect(failed.status).toBeGreaterThanOrEqual(500);
    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job).toMatchObject({ state: 'CREATED', reservationId: null, creditsReserved: 0 });
    const reservation = await ctx.prisma.creditReservation.findFirst();
    expect(reservation?.state).toBe('RELEASED');

    brokerDown = false;
    expect((await start(jobId)).status).toBe(201);
    expect(enqueued).toHaveLength(1);
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

    // Only the accepted CV counts: a rejected file must never cost a credit.
    expect(await ctx.prisma.screeningCandidate.count({ where: { jobId } })).toBe(1);
    const started = await start(jobId);
    const reservation = await ctx.prisma.creditReservation.findFirst();
    expect(reservation?.reservedCredits).toBe(started.body.data.job.creditsReserved);
    expect(started.body.data.job.totalCandidates).toBe(1);
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

  it('stores the maximum ZIP batch in one transaction and preserves upload order', async () => {
    const jobId = await createJob();
    await grantCredits(100);
    const candidates = Array.from({ length: LIMITS.MAX_SCREENING_CVS }, (_, index) => ({
      name: `batch/kandidat-${String(index + 1).padStart(2, '0')}.pdf`,
      data: buildTextPdf(CV_LINES),
    }));

    const response = await upload(jobId, [{ buffer: buildZip(candidates), name: 'batch.zip' }]);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const batch = response.body.data.batch;
    expect(batch.acceptedCount).toBe(LIMITS.MAX_SCREENING_CVS);
    expect(batch.accepted.map((candidate: { fileName: string }) => candidate.fileName)).toEqual(
      candidates.map((candidate) => candidate.name.split('/').pop()),
    );
    expect(await ctx.prisma.screeningCandidate.count({ where: { jobId } })).toBe(
      LIMITS.MAX_SCREENING_CVS,
    );
    expect(
      await ctx.prisma.screeningJobEvent.count({
        where: { jobId, type: 'CANDIDATE_QUEUED' },
      }),
    ).toBe(LIMITS.MAX_SCREENING_CVS);
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

  it('keeps the uploaded list when an unaffordable batch is started', async () => {
    const jobId = await createJob();

    const uploaded = await upload(jobId, [
      { buffer: buildTextPdf(CV_LINES), name: 'andi.pdf' },
      { buffer: buildTextPdf(CV_LINES), name: 'budi.pdf' },
    ]);
    expect(uploaded.status).toBe(201);

    const response = await start(jobId);

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(enqueued).toEqual([]);
    expect(await ctx.prisma.screeningCandidate.count({ where: { jobId } })).toBe(2);
    expect(await ctx.prisma.creditReservation.count()).toBe(0);

    const job = await ctx.prisma.screeningJob.findUnique({ where: { id: jobId } });
    expect(job?.state).toBe('CREATED');
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
