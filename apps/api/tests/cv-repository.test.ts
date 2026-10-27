import type { CvRepository } from '../src/repositories/cv.repository.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

type DocumentInput = Parameters<CvRepository['createDocument']>[0];

/**
 * Persistence behaviour for CV documents, analyses and enhancements.
 *
 * Runs against real PostgreSQL semantics (PGlite) so cascades, the soft-delete
 * update and JSON round-trips are exercised for real.
 */
describe('CvRepository', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let repository: CvRepository;
  let userId: string;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    const { CvRepository: CvRepositoryImpl } = await import('../src/repositories/cv.repository.js');
    repository = new CvRepositoryImpl();
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    const user = await ctx.prisma.user.create({
      data: { email: `cv-${Date.now()}@example.com`, fullName: 'CV Owner' },
    });
    userId = user.id;
  });

  async function createDocument(overrides: Partial<DocumentInput> = {}) {
    return repository.createDocument({
      userId,
      kind: 'ORIGINAL',
      fileName: 'cv.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
      pageCount: 2,
      textContent: 'Ringkasan profesional yang diekstrak dari PDF.',
      textHash: 'hash-original',
      ...overrides,
    });
  }

  it('stores an uploaded document with its extracted text', async () => {
    const created = await createDocument();

    expect(created.id).toBeTruthy();
    expect(created.userId).toBe(userId);
    expect(created.kind).toBe('ORIGINAL');
    expect(created.pageCount).toBe(2);
    expect(created.deletedAt).toBeNull();

    const found = await repository.findDocument(created.id);
    expect(found?.textContent).toBe('Ringkasan profesional yang diekstrak dari PDF.');
  });

  it('returns the newest original document and ignores other kinds', async () => {
    const older = await createDocument({ fileName: 'cv-old.pdf', textHash: 'older' });
    const newest = await createDocument({ fileName: 'cv-new.pdf', textHash: 'newer' });
    await createDocument({ kind: 'ENHANCED', fileName: 'cv-enhanced.pdf', textHash: 'enhanced' });

    // created_at has coarse resolution on a fast machine; pin the older row explicitly.
    await ctx.prisma.cvDocument.update({
      where: { id: older.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const latest = await repository.findLatestDocumentForUser(userId);
    expect(latest?.id).toBe(newest.id);
    expect(latest?.fileName).toBe('cv-new.pdf');
  });

  it('soft-deletes a document and clears its text', async () => {
    const created = await createDocument();

    await repository.deleteDocument(created.id, userId);

    const deleted = await ctx.prisma.cvDocument.findUniqueOrThrow({ where: { id: created.id } });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.textContent).toBeNull();
    expect(await repository.findDocument(created.id)).toBeNull();
  });

  it('scopes self-service deletion to the owning user', async () => {
    const created = await createDocument();
    const otherUser = await ctx.prisma.user.create({
      data: { email: `other-${Date.now()}@example.com` },
    });

    await repository.deleteDocument(created.id, otherUser.id);

    const untouched = await ctx.prisma.cvDocument.findUniqueOrThrow({ where: { id: created.id } });
    expect(untouched.deletedAt).toBeNull();
    expect(untouched.textContent).not.toBeNull();
  });

  it('paginates analysis history newest first', async () => {
    const document = await createDocument();
    const base = Date.now();
    for (let index = 0; index < 3; index += 1) {
      await repository.createAnalysis({
        documentId: document.id,
        userId,
        kind: 'FREE_AUDIT',
        provider: 'mock',
        model: 'mock-model',
        promptVersion: 'JOB_SEEKER_AUDIT_V1',
        atsScore: 60 + index,
        result: { atsScore: 60 + index, summary: `run ${index}` },
        creditsCharged: 0,
      });
      await ctx.db.pglite.exec(
        `UPDATE cv_analyses SET created_at = to_timestamp(${(base + index) / 1000}) WHERE ats_score = ${60 + index}`,
      );
    }

    const firstPage = await repository.listAnalyses(userId, 0, 2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0]?.atsScore).toBe(62);
    expect(firstPage.items[1]?.atsScore).toBe(61);

    const secondPage = await repository.listAnalyses(userId, 2, 2);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.atsScore).toBe(60);
  });

  it('round-trips a validated analysis result as JSON', async () => {
    const created = await repository.createAnalysis({
      documentId: null,
      userId,
      kind: 'DEEP_ANALYSIS',
      provider: 'deepseek',
      model: 'deepseek-chat',
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
      atsScore: 78,
      result: {
        atsScore: 78,
        strengths: ['Struktur jelas'],
        weaknesses: ['Metrik kurang'],
        missingSections: ['Portofolio'],
      },
      creditsCharged: 2,
    });

    const found = await repository.findAnalysis(created.id);
    expect(found?.result).toMatchObject({
      atsScore: 78,
      strengths: ['Struktur jelas'],
      missingSections: ['Portofolio'],
    });
    expect(found?.creditsCharged).toBe(2);
  });

  it('tracks an enhancement from PROCESSING to COMPLETED', async () => {
    const source = await createDocument();
    const enhancement = await repository.createEnhancement({
      userId,
      sourceDocumentId: source.id,
      options: { targetRole: 'Backend Engineer', templateKey: 'PROFESSIONAL' },
      templateKey: 'PROFESSIONAL',
      reservationId: null,
      promptVersion: 'JOB_SEEKER_ENHANCE_V1',
    });

    expect(enhancement.status).toBe('PROCESSING');
    expect(enhancement.options).toMatchObject({ targetRole: 'Backend Engineer' });
    expect(enhancement.promptVersion).toBe('JOB_SEEKER_ENHANCE_V1');

    const completed = await repository.updateEnhancement(enhancement.id, {
      status: 'COMPLETED',
      document: { summary: 'Disempurnakan tanpa menambah fakta baru.' },
      creditsCharged: 5,
      completedAt: new Date(),
    });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.creditsCharged).toBe(5);
    expect(completed.completedAt).not.toBeNull();
  });

  it('paginates enhancement history', async () => {
    const source = await createDocument();
    for (let index = 0; index < 2; index += 1) {
      await repository.createEnhancement({
        userId,
        sourceDocumentId: source.id,
        options: { index },
        templateKey: 'ATS_MINIMAL',
        reservationId: null,
        promptVersion: null,
      });
    }

    const page = await repository.listEnhancements(userId, 0, 10);
    expect(page.total).toBe(2);
    expect(page.items.every((item) => item.status === 'PROCESSING')).toBe(true);
  });

  it('cascades documents, analyses and enhancements when a user is deleted', async () => {
    const document = await createDocument();
    await repository.createAnalysis({
      documentId: document.id,
      userId,
      kind: 'FREE_AUDIT',
      provider: 'mock',
      model: 'mock-model',
      promptVersion: 'JOB_SEEKER_AUDIT_V1',
      atsScore: 55,
      result: { atsScore: 55 },
      creditsCharged: 0,
    });
    await repository.createEnhancement({
      userId,
      sourceDocumentId: document.id,
      options: {},
      templateKey: 'ATS_MINIMAL',
      reservationId: null,
      promptVersion: null,
    });

    await ctx.prisma.user.delete({ where: { id: userId } });

    expect(await ctx.prisma.cvDocument.count()).toBe(0);
    expect(await ctx.prisma.cvAnalysis.count()).toBe(0);
    expect(await ctx.prisma.cvEnhancement.count()).toBe(0);
  });
});
