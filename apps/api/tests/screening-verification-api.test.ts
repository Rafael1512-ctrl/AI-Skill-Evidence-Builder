import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bulkVerificationResponseSchema,
  candidateVerificationResponseSchema,
  screeningResultPayloadResponseSchema,
  screeningVerificationEstimateResponseSchema,
} from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { creditService } from '../src/services/credit.service.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildTextPdf } from './helpers/pdf.js';

/**
 * Evidence verification endpoints, end to end against PGlite.
 *
 * The outbound fetcher and the AI provider stay on their offline mocks (`OUTBOUND_HTTP_PROVIDER=mock`,
 * `AI_PROVIDER=mock`), so a candidate with a public GitHub link is fetched and summarised
 * deterministically: no test ever touches a real provider. What these tests pin is the credit
 * contract - who is eligible, what the preflight costs, and that nothing is charged twice.
 */

/**
 * Builds CV lines that clear the extraction thresholds (>= 60 characters and >= 12 words) or the
 * upload is rejected as a scanned document. The optional handle is the link the mock fetcher
 * resolves. Every fixture uses a distinct handle: the integration snapshot cache is keyed by URL,
 * so two candidates sharing one link would deliberately reuse one fetched page (and be billed once).
 */
function cv(handle: string | null): string[] {
  const lines = [
    'Software Engineer dengan pengalaman lima tahun membangun layanan backend.',
    'Keahlian teknis meliputi Node.js, TypeScript, PostgreSQL, Docker dan pengujian otomatis.',
  ];
  return handle === null ? lines : [...lines, `Portofolio publik: https://github.com/${handle}`];
}

const VALID_JOB = {
  title: 'Backend Engineer',
  description: 'Kami mencari backend engineer berpengalaman dengan Node.js dan PostgreSQL.',
  requirements: [
    {
      text: 'Pengalaman Node.js',
      category: 'TECHNICAL_SKILLS',
      requirementClass: 'REQUIRED',
      weight: 100,
      hardRequirement: false,
    },
  ],
};

describe('candidate verification API', () => {
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

  async function grantCredits(credits: number): Promise<void> {
    await creditService.grantTopUp({
      userId: session.userId,
      credits,
      amountIdr: credits * 1_000,
      paymentTransactionId: `pay-${session.userId}-${credits}`,
    });
  }

  /**
   * Uploads the batch, then marks every candidate `COMPLETED`.
   *
   * Verification eligibility requires a finished extraction, and this suite exercises the
   * verification endpoints rather than the queue, so the state is set directly instead of
   * running a worker. The upload's per-CV reservation stays `ACTIVE` (no worker settles it),
   * which the balance assertions account for through the wallet's `available` field.
   */
  async function uploadAndComplete(
    jobId: string,
    files: ReadonlyArray<{ name: string; lines: readonly string[] }>,
  ): Promise<string[]> {
    let call = request(app).post(`/api/screening/jobs/${jobId}/candidates`).set(bearer(session));
    for (const file of files) call = call.attach('files', buildTextPdf(file.lines), file.name);

    const response = await call;
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    await ctx.prisma.screeningCandidate.updateMany({
      where: { jobId },
      data: { state: 'COMPLETED' },
    });

    return (response.body.data.batch.accepted as Array<{ id: string }>).map((item) => item.id);
  }

  function getEstimate(jobId: string, target: DevSession = session) {
    return request(app)
      .get(`/api/screening/jobs/${jobId}/verification/estimate`)
      .set(bearer(target));
  }

  function postBulk(jobId: string, target: DevSession = session) {
    return request(app).post(`/api/screening/jobs/${jobId}/verification`).set(bearer(target));
  }

  function postIndividual(jobId: string, candidateId: string, target: DevSession = session) {
    return request(app)
      .post(`/api/screening/jobs/${jobId}/candidates/${candidateId}/verification`)
      .set(bearer(target));
  }

  async function getWalletSnapshot(target: DevSession = session) {
    const response = await request(app).get('/api/credits/wallet').set(bearer(target));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body.data as { balance: number; reserved: number; available: number };
  }

  it('requires a session and hides another user job', async () => {
    const jobId = await createJob();
    const other = await signUpDevUser(app);
    await grantCredits(10);
    const candidateId = (
      await uploadAndComplete(jobId, [{ name: 'andi.pdf', lines: cv('andi') }])
    )[0] as string;

    expect(
      (await request(app).get(`/api/screening/jobs/${jobId}/verification/estimate`)).status,
    ).toBe(401);
    expect((await request(app).post(`/api/screening/jobs/${jobId}/verification`)).status).toBe(401);
    expect(
      (
        await request(app).post(
          `/api/screening/jobs/${jobId}/candidates/${candidateId}/verification`,
        )
      ).status,
    ).toBe(401);

    expect((await getEstimate(jobId, other)).status).toBe(404);
    expect((await postBulk(jobId, other)).status).toBe(404);
    expect((await postIndividual(jobId, candidateId, other)).status).toBe(404);
  });

  it('verifies one candidate through the existing endpoint and charges one unit', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    const [candidateId] = await uploadAndComplete(jobId, [{ name: 'andi.pdf', lines: cv('andi') }]);

    const before = await getWalletSnapshot();

    const response = await postIndividual(jobId, candidateId as string);
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const parsed = candidateVerificationResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.data.verification).toMatchObject({
      verificationStatus: 'SUPPORTED',
      creditsCharged: 2,
      disabled: false,
    });

    // The wallet reflects the charge, so the UI's "sesudah" balance can be refreshed from it.
    const after = await getWalletSnapshot();
    expect(after.available).toBe(before.available - 2);

    // The stored result now shows the verified status, which the screen refetches on success.
    const results = await request(app)
      .get(`/api/screening/jobs/${jobId}/results`)
      .set(bearer(session));
    const parsedResults = screeningResultPayloadResponseSchema.safeParse(results.body.data);
    expect(parsedResults.success, JSON.stringify(parsedResults.error?.issues)).toBe(true);
    expect(results.body.data.results.candidates[0].verificationStatus).toBe('SUPPORTED');
  });

  it('blocks individual verification when the balance cannot cover one candidate', async () => {
    const jobId = await createJob();
    // One credit covers only the batch reservation, leaving nothing for verification.
    await grantCredits(1);
    const [candidateId] = await uploadAndComplete(jobId, [{ name: 'andi.pdf', lines: cv('andi') }]);

    const response = await postIndividual(jobId, candidateId as string);
    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');

    const candidate = await ctx.prisma.screeningCandidate.findUnique({
      where: { id: candidateId as string },
    });
    expect(candidate?.verificationStatus).toBe('NOT_CHECKED');
  });

  it('counts only eligible candidates and prices the bulk preflight from the pricing service', async () => {
    const jobId = await createJob();
    await grantCredits(20);
    await uploadAndComplete(jobId, [
      { name: 'andi.pdf', lines: cv('andi') },
      { name: 'budi.pdf', lines: cv('budi') },
      { name: 'citra.pdf', lines: cv(null) },
    ]);

    const response = await getEstimate(jobId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const parsed = screeningVerificationEstimateResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.data.estimate).toMatchObject({
      feature: 'EVIDENCE_VERIFICATION',
      unitCredits: 2,
      eligibleCount: 2,
      totalCredits: 4,
      noLinkCount: 1,
      alreadyVerifiedCount: 0,
      inProgressCount: 0,
      sufficient: true,
      shortfall: 0,
    });
  });

  it('verifies every eligible candidate in one bulk request and refreshes the wallet', async () => {
    const jobId = await createJob();
    await grantCredits(20);
    await uploadAndComplete(jobId, [
      { name: 'andi.pdf', lines: cv('andi') },
      { name: 'budi.pdf', lines: cv('budi') },
      { name: 'citra.pdf', lines: cv(null) },
    ]);
    const before = await getWalletSnapshot();

    const response = await postBulk(jobId);
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const parsed = bulkVerificationResponseSchema.safeParse(response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(response.body.data.verification).toMatchObject({
      jobId,
      unitCredits: 2,
      eligibleCount: 2,
      verifiedCount: 2,
      creditsCharged: 4,
    });

    const after = await getWalletSnapshot();
    expect(after.available).toBe(before.available - 4);

    const candidates = await ctx.prisma.screeningCandidate.findMany({
      where: { jobId },
      orderBy: { fileName: 'asc' },
    });
    const byName = new Map(candidates.map((candidate) => [candidate.fileName, candidate]));
    expect(byName.get('andi.pdf')?.verificationStatus).toBe('SUPPORTED');
    expect(byName.get('budi.pdf')?.verificationStatus).toBe('SUPPORTED');
    // The candidate with no fetchable link is left NOT_CHECKED and never charged.
    expect(byName.get('citra.pdf')?.verificationStatus).toBe('NOT_CHECKED');
  });

  it('excludes already-verified candidates and never charges for a replayed bulk request', async () => {
    const jobId = await createJob();
    await grantCredits(20);
    const [firstId] = await uploadAndComplete(jobId, [
      { name: 'andi.pdf', lines: cv('andi') },
      { name: 'budi.pdf', lines: cv('budi') },
    ]);

    const single = await postIndividual(jobId, firstId as string);
    expect(single.status).toBe(201);

    const estimate = await getEstimate(jobId);
    expect(estimate.body.data.estimate).toMatchObject({
      eligibleCount: 1,
      totalCredits: 2,
      alreadyVerifiedCount: 1,
    });

    const bulk = await postBulk(jobId);
    expect(bulk.status).toBe(201);
    expect(bulk.body.data.verification).toMatchObject({ verifiedCount: 1, creditsCharged: 2 });

    // A replay has nothing eligible left, so it reserves nothing and charges nothing.
    const replay = await postBulk(jobId);
    expect(replay.status).toBe(201);
    expect(replay.body.data.verification).toMatchObject({
      eligibleCount: 0,
      verifiedCount: 0,
      creditsCharged: 0,
    });

    const all = await ctx.prisma.screeningCandidate.findMany({ where: { jobId } });
    expect(all.every((candidate) => candidate.verificationStatus === 'SUPPORTED')).toBe(true);
  });

  it('refuses an unaffordable bulk request without reserving or verifying anything', async () => {
    const jobId = await createJob();
    // Five credits: three are held by the batch reservation, leaving two for a batch that needs six.
    await grantCredits(5);
    await uploadAndComplete(jobId, [
      { name: 'andi.pdf', lines: cv('andi') },
      { name: 'budi.pdf', lines: cv('budi') },
      { name: 'dita.pdf', lines: cv('dita') },
    ]);

    const estimate = await getEstimate(jobId);
    expect(estimate.body.data.estimate).toMatchObject({
      eligibleCount: 3,
      totalCredits: 6,
      sufficient: false,
      shortfall: 4,
    });

    const response = await postBulk(jobId);
    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');

    const candidates = await ctx.prisma.screeningCandidate.findMany({ where: { jobId } });
    expect(candidates.every((candidate) => candidate.verificationStatus === 'NOT_CHECKED')).toBe(
      true,
    );
    // No verification hold was created: the failed bulk request reserved nothing at all.
    expect(
      await ctx.prisma.creditReservation.count({ where: { feature: 'EVIDENCE_VERIFICATION' } }),
    ).toBe(0);
  });
});
