import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  SCORING_ENGINE_VERSION,
  candidateEvidenceEnvelopeSchema,
  screeningReportResultSchema,
  screeningResultPayloadSchema,
  type CandidateEvidenceEnvelope,
} from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { setScreeningQueue } from '../src/queues/index.js';
import { InProcessScreeningQueue } from '../src/queues/in-process.queue.js';
import { creditService } from '../src/services/credit.service.js';
import { setCandidateProcessor } from '../src/workers/screening.processor.js';
import { startScreeningWorker } from '../src/workers/screening.worker.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';
import { buildTextPdf } from './helpers/pdf.js';

/**
 * Results and report endpoints, end to end against PGlite.
 *
 * The stub processor returns a crafted evidence envelope, so the deterministic engine does
 * the scoring: these tests cover ranking, the per-criterion payload, unmet hard
 * requirements, the CSV/PDF artifacts and the report history - not the model.
 */

/**
 * Must clear the extraction thresholds (>= 60 characters and >= 12 words) or the batch upload is
 * rejected as a scanned document and every case in this file fails at the upload step.
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
  requirements: [
    {
      text: 'Pengalaman Node.js',
      category: 'TECHNICAL_SKILLS',
      requirementClass: 'REQUIRED',
      weight: 60,
      hardRequirement: true,
    },
    {
      text: 'Kemampuan memimpin tim',
      category: 'EXPERIENCE',
      requirementClass: 'PREFERRED',
      weight: 40,
    },
  ],
} as const;

/** A candidate whose hard requirement is met but whose preferred one is not. */
function envelopeFor(name: string, leadership: 'FOUND' | 'NOT_FOUND'): CandidateEvidenceEnvelope {
  return {
    promptVersion: 'HRD_EVIDENCE_EXTRACTION_V1',
    preferenceVersion: 0,
    scoringConfigurationVersion: SCORING_ENGINE_VERSION,
    requirementVersion: 1,
    provider: 'stub',
    model: 'stub-v1',
    processedAt: '2026-09-26T10:00:00.000Z',
    grounding: { droppedQuotes: 0, downgradedCriteria: 0, pageVerification: 'unavailable' },
    evidence: {
      candidateName: name,
      summary: `Ringkasan ${name}`,
      gaps: [],
      uncertainties: [],
      criteria: [
        {
          requirementId: '',
          status: 'FOUND',
          confidence: 0.9,
          evidence: [
            {
              quote: 'lima tahun pengalaman Node.js',
              source: 'CV',
              page: null,
              url: null,
              note: null,
            },
          ],
          notes: '',
        },
        {
          requirementId: '',
          status: leadership,
          confidence: leadership === 'FOUND' ? 0.9 : 0.2,
          evidence:
            leadership === 'FOUND'
              ? [
                  {
                    quote: 'memimpin tim kecil berisi empat orang',
                    source: 'CV',
                    page: null,
                    url: null,
                    note: null,
                  },
                ]
              : [],
          notes: '',
        },
      ],
    },
  };
}

describe('screening results and reports API', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let session: DevSession;
  let queue: InProcessScreeningQueue;

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
    queue = new InProcessScreeningQueue({ concurrency: 2, attempts: 1, backoffMs: 5 });
    setScreeningQueue(queue);
    setCandidateProcessor(null);
  });

  afterEach(async () => {
    await queue.stop();
    setScreeningQueue(null);
    setCandidateProcessor(null);
  });

  async function createJob(): Promise<string> {
    const response = await request(app)
      .post('/api/screening/jobs')
      .set(bearer(session))
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

  async function upload(jobId: string, names: readonly string[]): Promise<void> {
    let call = request(app).post(`/api/screening/jobs/${jobId}/candidates`).set(bearer(session));
    for (const name of names) call = call.attach('files', buildTextPdf(CV_LINES), name);
    const response = await call;
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  }

  /**
   * Scores a batch with the crafted envelopes: the stub returns one envelope per candidate
   * in upload order (by file name), which is exactly what the real processor would do.
   */
  async function processWith(
    plan: ReadonlyArray<{ fileName: string; leadership: 'FOUND' | 'NOT_FOUND' }>,
  ): Promise<void> {
    const pending = [...plan];
    setCandidateProcessor({
      name: 'stub',
      process: async ({ candidate }) => {
        const match = pending.find((item) => item.fileName === candidate.fileName);
        if (!match) throw new Error(`no plan for ${candidate.fileName}`);
        const envelope = envelopeFor(candidate.candidateName, match.leadership);
        // The requirement ids are only known to the database, so they are filled in here.
        const job = await ctx.prisma.screeningJob.findUnique({
          where: { id: candidate.jobId },
          include: { requirements: { orderBy: { sortOrder: 'asc' } } },
        });
        const requirementIds = job?.requirements.map((requirement) => requirement.id) ?? [];
        envelope.evidence.criteria = envelope.evidence.criteria.map((criterion, index) => ({
          ...criterion,
          requirementId: requirementIds[index] ?? '',
        }));
        return { summary: envelope.evidence.summary, analysis: envelope };
      },
    });
    await startScreeningWorker();
  }

  function getResults(jobId: string, target: DevSession = session) {
    return request(app).get(`/api/screening/jobs/${jobId}/results`).set(bearer(target));
  }

  function exportReport(jobId: string, format: string, target: DevSession = session) {
    return request(app)
      .post(`/api/screening/jobs/${jobId}/reports`)
      .set(bearer(target))
      .send({ format });
  }

  it('requires a session and hides another user job', async () => {
    const jobId = await createJob();
    const other = await signUpDevUser(app);

    expect((await request(app).get(`/api/screening/jobs/${jobId}/results`)).status).toBe(401);
    expect(
      (await request(app).post(`/api/screening/jobs/${jobId}/reports`).send({ format: 'CSV' }))
        .status,
    ).toBe(401);
    expect((await getResults(jobId, other)).status).toBe(404);
    expect((await exportReport(jobId, 'CSV', other)).status).toBe(404);
    expect(
      (await request(app).get(`/api/screening/jobs/${jobId}/reports`).set(bearer(other))).status,
    ).toBe(404);
  });

  it('returns ranked results with per-criterion evidence and the frozen versions', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await processWith([
      { fileName: 'andi.pdf', leadership: 'FOUND' },
      { fileName: 'budi.pdf', leadership: 'NOT_FOUND' },
    ]);

    await upload(jobId, ['budi.pdf', 'andi.pdf']);
    await queue.waitForIdle();

    const response = await getResults(jobId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const parsed = screeningResultPayloadSchema.safeParse(response.body.data.results);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const results = response.body.data.results;
    expect(results.methodologyNote).toContain('bukan penilaian');
    expect(results.job.state).toBe('COMPLETED');
    expect(results.job.scoringConfigurationVersion).toBe(SCORING_ENGINE_VERSION);

    // Ranked by the deterministic score, not by upload order.
    expect(results.candidates.map((item: { candidateName: string }) => item.candidateName)).toEqual(
      ['andi', 'budi'],
    );
    expect(results.candidates[0].score).toBe(100);
    expect(results.candidates[0].eligibilityStatus).toBe('HIGH_MATCH');
    expect(results.candidates[0].unmetHardRequirements).toEqual([]);

    // Met hard requirement + missing preferred one => 60, and the candidate stays visible.
    const second = results.candidates[1];
    expect(second.score).toBe(60);
    expect(second.eligibilityStatus).toBe('CONSIDER');
    expect(second.criteriaResults).toHaveLength(2);
    expect(second.requiredCriteria).toHaveLength(1);
    expect(second.preferredCriteria).toHaveLength(1);
    expect(second.criteriaResults[0].criterion).toBe('Pengalaman Node.js');
    expect(second.criteriaResults[0].evidence[0].quote).toContain('Node.js');
    expect(second.gaps).toEqual(['Kemampuan memimpin tim']);
    expect(second.fileName).toBe('budi.pdf');
    expect(second.verificationStatus).toBe('NOT_CHECKED');
    expect(second.scoringConfigurationVersion).toBe(SCORING_ENGINE_VERSION);
  });

  it('marks an unmet hard requirement REQUIREMENT_NOT_MET and still returns the candidate', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await processWith([{ fileName: 'andi.pdf', leadership: 'FOUND' }]);

    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    // Flip the hard requirement's stored evidence to NOT_FOUND, as a CV without Node.js would.
    const candidate = await ctx.prisma.screeningCandidate.findFirst({ where: { jobId } });
    const hard = await ctx.prisma.screeningRequirement.findFirst({
      where: { jobId, hardRequirement: true },
    });
    await ctx.prisma.screeningCriterionResult.updateMany({
      where: { candidateId: candidate?.id, requirementId: hard?.id },
      data: { status: 'NOT_FOUND' },
    });
    await ctx.prisma.screeningCandidate.update({
      where: { id: candidate?.id as string },
      data: { score: 40, eligibilityStatus: 'REQUIREMENT_NOT_MET' },
    });

    const response = await getResults(jobId);
    const first = response.body.data.results.candidates[0];

    expect(first.eligibilityStatus).toBe('REQUIREMENT_NOT_MET');
    expect(first.unmetHardRequirements).toEqual(['Pengalaman Node.js']);
    // The candidate is still present with its criteria - hard requirements never hide anyone.
    expect(first.criteriaResults).toHaveLength(2);
  });

  it('renders a CSV report, records it and lists it', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await processWith([{ fileName: 'andi.pdf', leadership: 'FOUND' }]);
    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const response = await exportReport(jobId, 'CSV');
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const parsed = screeningReportResultSchema.safeParse(response.body.data.report);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const report = response.body.data.report;
    expect(report.format).toBe('CSV');
    expect(report.mimeType).toContain('text/csv');
    expect(report.creditsCharged).toBe(0);
    expect(report.contentHash).toHaveLength(64);
    expect(report.fileName).toMatch(/^laporan-screening-.+-\d{4}-\d{2}-\d{2}\.csv$/);

    const csv = Buffer.from(report.contentBase64, 'base64').toString('utf8');
    expect(csv).toContain('kandidat');
    // The label is derived from the uploaded file name (`andi.pdf`), so it is lowercase.
    expect(csv).toContain('andi.pdf');
    expect(csv.toLowerCase()).toContain('andi');
    expect(csv).toContain('Pengalaman Node.js');
    expect(csv).toContain('FOUND');

    const stored = await ctx.prisma.generatedReport.findMany({ where: { screeningJobId: jobId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.storagePath).toBeNull();
    expect(stored[0]?.sizeBytes).toBeGreaterThan(0);

    const list = await request(app)
      .get(`/api/screening/jobs/${jobId}/reports?page=1&pageSize=10`)
      .set(bearer(session));
    expect(list.body.data.reports.total).toBe(1);
    expect(list.body.data.reports.items[0]).toMatchObject({
      format: 'CSV',
      fileName: report.fileName,
    });
    // Metadata only: the list never re-sends the bytes.
    expect(list.body.data.reports.items[0]).not.toHaveProperty('contentBase64');
  });

  it('renders a PDF report with the offline renderer', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await processWith([{ fileName: 'andi.pdf', leadership: 'FOUND' }]);
    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const response = await exportReport(jobId, 'PDF');

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const report = response.body.data.report;
    expect(report.format).toBe('PDF');
    expect(report.mimeType).toBe('application/pdf');
    expect(Buffer.from(report.contentBase64, 'base64').byteLength).toBe(report.sizeBytes);
  });

  it('rejects an unknown format and an empty batch', async () => {
    const jobId = await createJob();
    await grantCredits(10);

    expect((await exportReport(jobId, 'XLSX')).status).toBe(400);
    // Nothing uploaded yet: there is nothing to report.
    expect((await exportReport(jobId, 'CSV')).status).toBe(409);
  });

  it('keeps the envelope contract that scoring depends on', async () => {
    const jobId = await createJob();
    await grantCredits(10);
    await processWith([{ fileName: 'andi.pdf', leadership: 'FOUND' }]);
    await upload(jobId, ['andi.pdf']);
    await queue.waitForIdle();

    const candidate = await ctx.prisma.screeningCandidate.findFirst({ where: { jobId } });
    expect(candidateEvidenceEnvelopeSchema.safeParse(candidate?.analysisJson).success).toBe(true);
  });
});
