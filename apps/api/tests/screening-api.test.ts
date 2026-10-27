import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EXAMPLE_CATEGORY_WEIGHTS,
  SCORING_ENGINE_VERSION,
  screeningJobDetailSchema,
} from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * End-to-end coverage of recruiter requirements.
 *
 * Runs against real PostgreSQL semantics (PGlite): versioned preference snapshots, the
 * frozen versions recorded on a job, requirement ordering and the owner boundary.
 * Batch upload (Phase 11), queueing (Phase 12) and credits are out of scope here.
 */

const VALID_JOB = {
  title: 'Backend Engineer',
  description: 'Kami mencari backend engineer berpengalaman dengan Node.js dan PostgreSQL.',
  requirements: [
    {
      text: 'Pengalaman minimal 3 tahun dengan Node.js',
      category: 'TECHNICAL_SKILLS',
      requirementClass: 'REQUIRED',
      weight: 30,
      hardRequirement: true,
    },
    {
      text: 'Pengalaman memimpin tim kecil',
      category: 'EXPERIENCE',
      requirementClass: 'PREFERRED',
      weight: 15,
    },
  ],
} as const;

describe('screening API', () => {
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

  function getPreferences(target: DevSession = session) {
    return request(app).get('/api/screening/preferences').set(bearer(target));
  }

  function putPreferences(body: object, target: DevSession = session) {
    return request(app).put('/api/screening/preferences').set(bearer(target)).send(body);
  }

  function createJob(body: object = VALID_JOB, target: DevSession = session) {
    return request(app).post('/api/screening/jobs').set(bearer(target)).send(body);
  }

  async function jobFixture(body: object = VALID_JOB, target: DevSession = session) {
    const response = await createJob(body, target);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.job as { id: string };
  }

  /* ------------------------------------------------------------------ */
  /* Authentication                                                      */
  /* ------------------------------------------------------------------ */

  it('requires a session for preferences and jobs', async () => {
    expect((await request(app).get('/api/screening/preferences')).status).toBe(401);
    expect((await request(app).put('/api/screening/preferences').send({})).status).toBe(401);
    expect((await request(app).post('/api/screening/jobs').send(VALID_JOB)).status).toBe(401);
    expect(await ctx.prisma.recruiterPreference.count()).toBe(0);
    expect(await ctx.prisma.screeningJob.count()).toBe(0);
  });

  /* ------------------------------------------------------------------ */
  /* Preferences                                                         */
  /* ------------------------------------------------------------------ */

  it('returns the shared defaults at version 0 before anything is saved', async () => {
    const response = await getPreferences();

    expect(response.status).toBe(200);
    expect(response.body.data.preference.version).toBe(0);
    expect(response.body.data.preference.updatedAt).toBeNull();
    expect(response.body.data.preference.preferences.portfolioImportance).toBe(50);
    expect(response.body.data.preference.preferences.preferredSkills).toEqual([]);
    // A read must not create rows.
    expect(await ctx.prisma.recruiterPreference.count()).toBe(0);
    expect(await ctx.prisma.recruiterPreferenceVersion.count()).toBe(0);
  });

  it('saves a new version and snapshots it immutably', async () => {
    const first = await putPreferences({
      preferredSkills: ['TypeScript'],
      portfolioImportance: 70,
      screeningNotes: 'Fokus pada dampak nyata.',
    });

    expect(first.status).toBe(200);
    expect(first.body.data.preference.version).toBe(1);
    expect(first.body.data.preference.preferences.preferredSkills).toEqual(['TypeScript']);

    const second = await putPreferences({
      preferredSkills: ['TypeScript', 'Node.js'],
      portfolioImportance: 80,
    });
    expect(second.body.data.preference.version).toBe(2);

    const versions = await request(app)
      .get('/api/screening/preferences/versions?page=1&pageSize=10')
      .set(bearer(session));

    expect(versions.status).toBe(200);
    expect(versions.body.data.total).toBe(2);
    const items = versions.body.data.items as Array<{
      version: number;
      preferences: { preferredSkills: string[]; portfolioImportance: number };
    }>;
    // Newest first, and the older snapshot still shows the older values.
    expect(items.map((item) => item.version)).toEqual([2, 1]);
    expect(items[1]?.preferences.preferredSkills).toEqual(['TypeScript']);
    expect(items[0]?.preferences.portfolioImportance).toBe(80);

    const current = await getPreferences();
    expect(current.body.data.preference.version).toBe(2);
    expect(current.body.data.preference.preferences.preferredSkills).toEqual([
      'TypeScript',
      'Node.js',
    ]);
  });

  it('applies schema defaults when saving an empty preference body', async () => {
    const response = await putPreferences({});

    expect(response.status).toBe(200);
    expect(response.body.data.preference.version).toBe(1);
    expect(response.body.data.preference.preferences).toMatchObject({
      preferredSkills: [],
      portfolioImportance: 50,
      screeningNotes: '',
    });
  });

  it('rejects a preference list over the shared cap', async () => {
    const response = await putPreferences({
      preferredSkills: Array.from({ length: 51 }, (_, index) => `skill-${index}`),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await ctx.prisma.recruiterPreference.count()).toBe(0);
  });

  /* ------------------------------------------------------------------ */
  /* Job creation                                                        */
  /* ------------------------------------------------------------------ */

  it('creates a CREATED job with its requirements and frozen versions', async () => {
    const response = await createJob();

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const parsed = screeningJobDetailSchema.safeParse(response.body.data.job);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    const job = response.body.data.job;
    expect(job.state).toBe('CREATED');
    expect(job.requirementVersion).toBe(1);
    expect(job.promptVersion).toBe('HRD_SCREENING_V1');
    expect(job.scoringConfigurationVersion).toBe(SCORING_ENGINE_VERSION);
    expect(job.totalCandidates).toBe(0);
    expect(job.creditsReserved).toBe(0);
    expect(job.creditsCharged).toBe(0);
    expect(job.categoryWeights).toBeNull();
    expect(job.requirements).toHaveLength(2);
    expect(job.requirements[0]).toMatchObject({
      sortOrder: 1,
      text: 'Pengalaman minimal 3 tahun dengan Node.js',
      category: 'TECHNICAL_SKILLS',
      requirementClass: 'REQUIRED',
      weight: 30,
      hardRequirement: true,
    });
    expect(job.requirements[1]).toMatchObject({ sortOrder: 2, hardRequirement: false });

    const row = await ctx.prisma.screeningJob.findUnique({ where: { id: job.id } });
    expect(row?.promptVersion).toBe('HRD_SCREENING_V1');
    expect(row?.preferenceVersion).toBe(0);
    expect(row?.reservationId).toBeNull();
  });

  it('applies requirement defaults for anything the recruiter omits', async () => {
    const job = await jobFixture({
      ...VALID_JOB,
      requirements: [{ text: 'Kemampuan komunikasi tertulis' }],
    });

    const detailed = await request(app).get(`/api/screening/jobs/${job.id}`).set(bearer(session));

    expect(detailed.body.data.job.requirements[0]).toMatchObject({
      category: 'OTHER',
      requirementClass: 'REQUIRED',
      weight: 10,
      hardRequirement: false,
    });
  });

  it('inherits the frozen preference version, weights and notes', async () => {
    await putPreferences({
      defaultWeights: EXAMPLE_CATEGORY_WEIGHTS,
      screeningNotes: 'Utamakan bukti dampak terukur.',
      preferredSkills: ['Node.js'],
    });

    const job = await jobFixture({ ...VALID_JOB, screeningNotes: undefined });

    expect(job).toBeDefined();
    const row = await ctx.prisma.screeningJob.findFirstOrThrow({
      where: { userId: session.userId },
    });
    expect(row.preferenceVersion).toBe(1);
    expect(row.categoryWeights).toEqual(EXAMPLE_CATEGORY_WEIGHTS);
    expect(row.screeningNotes).toBe('Utamakan bukti dampak terukur.');
  });

  it('lets the job override inherited weights and notes', async () => {
    await putPreferences({
      defaultWeights: EXAMPLE_CATEGORY_WEIGHTS,
      screeningNotes: 'Catatan lama.',
    });

    const job = await jobFixture({
      ...VALID_JOB,
      categoryWeights: { ...EXAMPLE_CATEGORY_WEIGHTS, OTHER: 0, EXPERIENCE: 35 },
      screeningNotes: 'Catatan khusus untuk posisi ini.',
    });

    const detailed = await request(app).get(`/api/screening/jobs/${job.id}`).set(bearer(session));

    expect(detailed.body.data.job.categoryWeights).toMatchObject({ EXPERIENCE: 35 });
    expect(detailed.body.data.job.screeningNotes).toBe('Catatan khusus untuk posisi ini.');
    const row = await ctx.prisma.screeningJob.findFirstOrThrow({
      where: { userId: session.userId },
    });
    expect(row.preferenceVersion).toBe(1);
  });

  it('records version 0 when the recruiter opts out of their preferences', async () => {
    await putPreferences({ defaultWeights: EXAMPLE_CATEGORY_WEIGHTS, screeningNotes: 'Catatan.' });

    const job = await jobFixture({ ...VALID_JOB, useRecruiterPreferences: false });

    expect(job).toBeDefined();
    const row = await ctx.prisma.screeningJob.findFirstOrThrow({
      where: { userId: session.userId },
    });
    expect(row.preferenceVersion).toBe(0);
    expect(row.categoryWeights).toBeNull();
    expect(row.screeningNotes).toBeNull();
  });

  it('records a STATE_CHANGED event when the job is created', async () => {
    const job = await jobFixture();

    const events = await ctx.prisma.screeningJobEvent.findMany({ where: { jobId: job.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('STATE_CHANGED');
  });

  /* ------------------------------------------------------------------ */
  /* Job validation                                                      */
  /* ------------------------------------------------------------------ */

  it('rejects a job without requirements', async () => {
    const response = await createJob({ ...VALID_JOB, requirements: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await ctx.prisma.screeningJob.count()).toBe(0);
  });

  it('rejects a job with more than 40 requirements', async () => {
    const response = await createJob({
      ...VALID_JOB,
      requirements: Array.from({ length: 41 }, (_, index) => ({ text: `Kriteria ${index}` })),
    });

    expect(response.status).toBe(400);
    expect(await ctx.prisma.screeningJob.count()).toBe(0);
  });

  it('rejects category weights that do not total 100', async () => {
    const response = await createJob({
      ...VALID_JOB,
      categoryWeights: {
        EXPERIENCE: 30,
        TECHNICAL_SKILLS: 25,
        PROJECTS: 20,
        EDUCATION: 5,
        PORTFOLIO: 10,
        OTHER: 0,
      },
    });

    expect(response.status).toBe(400);
    expect(await ctx.prisma.screeningJob.count()).toBe(0);
  });

  it('rejects a requirement weight outside the documented bounds', async () => {
    const response = await createJob({
      ...VALID_JOB,
      requirements: [{ text: 'Kriteria valid', weight: 101 }],
    });

    expect(response.status).toBe(400);
  });

  /* ------------------------------------------------------------------ */
  /* Ownership, listing, cancellation and progress                       */
  /* ------------------------------------------------------------------ */

  it('lists only the caller’s own jobs', async () => {
    await jobFixture();
    await jobFixture({ ...VALID_JOB, title: 'Data Engineer' });
    const stranger = await signUpDevUser(app);
    await jobFixture({ ...VALID_JOB, title: 'Milik orang lain' }, stranger);

    const response = await request(app)
      .get('/api/screening/jobs?page=1&pageSize=10')
      .set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(
      (response.body.data.items as Array<{ title: string }>).map((item) => item.title).sort(),
    ).toEqual(['Backend Engineer', 'Data Engineer']);
  });

  it('hides another user’s job behind a 404', async () => {
    const job = await jobFixture();
    const stranger = await signUpDevUser(app);

    expect(
      (await request(app).get(`/api/screening/jobs/${job.id}`).set(bearer(stranger))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/screening/jobs/${job.id}/progress`).set(bearer(stranger)))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/screening/jobs/${job.id}`)
          .set(bearer(stranger))
          .send({ state: 'CANCELLED' })
      ).status,
    ).toBe(404);
  });

  it('reports zeroed progress for a job with no candidates yet', async () => {
    const job = await jobFixture();

    const response = await request(app)
      .get(`/api/screening/jobs/${job.id}/progress`)
      .set(bearer(session));

    expect(response.status).toBe(200);
    expect(response.body.data.progress).toMatchObject({
      jobId: job.id,
      state: 'CREATED',
      total: 0,
      completed: 0,
      failed: 0,
      processing: 0,
      queued: 0,
      percent: 0,
      partialSuccess: false,
      finished: false,
    });
  });

  it('cancels a job once and refuses a second cancellation', async () => {
    const job = await jobFixture();

    const cancelled = await request(app)
      .patch(`/api/screening/jobs/${job.id}`)
      .set(bearer(session))
      .send({ state: 'CANCELLED' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.job.state).toBe('CANCELLED');
    expect(cancelled.body.data.job.cancelledAt).toBeTruthy();

    const progress = await request(app)
      .get(`/api/screening/jobs/${job.id}/progress`)
      .set(bearer(session));
    expect(progress.body.data.progress.finished).toBe(true);

    const again = await request(app)
      .patch(`/api/screening/jobs/${job.id}`)
      .set(bearer(session))
      .send({ state: 'CANCELLED' });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');

    const events = await ctx.prisma.screeningJobEvent.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: 'asc' },
    });
    // Two state changes (created, cancelled) plus the settlement's PROGRESS entry, which Phase 12
    // started writing when cancelling also fails the remaining candidates and releases the hold.
    expect(events.map((event) => event.type)).toEqual([
      'STATE_CHANGED',
      'STATE_CHANGED',
      'PROGRESS',
    ]);
    expect(events.filter((event) => event.type === 'STATE_CHANGED')).toHaveLength(2);
  });

  it('rejects any state change other than cancellation', async () => {
    const job = await jobFixture();

    const response = await request(app)
      .patch(`/api/screening/jobs/${job.id}`)
      .set(bearer(session))
      .send({ state: 'COMPLETED' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
