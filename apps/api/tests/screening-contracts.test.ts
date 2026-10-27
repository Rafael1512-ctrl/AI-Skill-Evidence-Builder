import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RECRUITER_PREFERENCES,
  EXAMPLE_CATEGORY_WEIGHTS,
  LIMITS,
  createScreeningJobSchema,
  recruiterPreferencesSchema,
  screeningBatchUploadResultSchema,
  screeningCandidateListSchema,
  screeningJobStateUpdateSchema,
} from '@aseb/shared';

import { defaultRecruiterPreferences } from '../src/services/recruiter-preference.service.js';
import { candidateNameFromFileName } from '../src/services/screening-batch.service.js';

/**
 * Screening contract tests. Pure and offline: they pin the schemas the screening API
 * validates against, and the drift risk between the shared defaults and the defaults the
 * service emits for a recruiter who has never saved preferences.
 */

function validJob(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Backend Engineer',
    description: 'Kami mencari backend engineer dengan pengalaman Node.js dan PostgreSQL.',
    requirements: [{ text: 'Pengalaman 3 tahun Node.js' }],
    ...overrides,
  };
}

describe('recruiter preference contract', () => {
  it('keeps the service defaults identical to the shared defaults', () => {
    expect(defaultRecruiterPreferences()).toEqual(DEFAULT_RECRUITER_PREFERENCES);
    expect(recruiterPreferencesSchema.parse({})).toEqual(DEFAULT_RECRUITER_PREFERENCES);
  });

  it('fills defaults for arrays, portfolio importance and notes', () => {
    const parsed = recruiterPreferencesSchema.parse({});

    expect(parsed.preferredSkills).toEqual([]);
    expect(parsed.portfolioImportance).toBe(50);
    expect(parsed.screeningNotes).toBe('');
    expect(parsed.defaultWeights).toBeUndefined();
  });

  it('caps every preference list', () => {
    const tooMany = Array.from(
      { length: LIMITS.MAX_PREFERENCE_ITEMS + 1 },
      (_, index) => `item-${index}`,
    );

    expect(recruiterPreferencesSchema.safeParse({ preferredSkills: tooMany }).success).toBe(false);
    expect(
      recruiterPreferencesSchema.safeParse({
        preferredSkills: tooMany.slice(0, LIMITS.MAX_PREFERENCE_ITEMS),
      }).success,
    ).toBe(true);
  });

  it('requires a complete category weight record that totals exactly 100', () => {
    expect(
      recruiterPreferencesSchema.safeParse({ defaultWeights: EXAMPLE_CATEGORY_WEIGHTS }).success,
    ).toBe(true);

    // Complete, but the total is 90.
    expect(
      recruiterPreferencesSchema.safeParse({
        defaultWeights: { ...EXAMPLE_CATEGORY_WEIGHTS, OTHER: 0, EDUCATION: 5 },
      }).success,
    ).toBe(false);
  });

  it('rejects a partial weight record: weights are all-or-nothing', () => {
    // Zod 4 makes an enum-keyed record exhaustive, so a partial map cannot slip through
    // and be silently renormalised by the scoring engine.
    const partial = recruiterPreferencesSchema.safeParse({
      defaultWeights: { EXPERIENCE: 60, TECHNICAL_SKILLS: 40 },
    });

    expect(partial.success).toBe(false);
  });
});

describe('screening job contract', () => {
  it('accepts a minimal job and applies requirement defaults', () => {
    const parsed = createScreeningJobSchema.parse(validJob());

    expect(parsed.useRecruiterPreferences).toBe(true);
    expect(parsed.requirements[0]).toMatchObject({
      category: 'OTHER',
      requirementClass: 'REQUIRED',
      weight: 10,
      hardRequirement: false,
    });
  });

  it('requires at least one requirement and caps the list at 40', () => {
    expect(createScreeningJobSchema.safeParse(validJob({ requirements: [] })).success).toBe(false);
    expect(
      createScreeningJobSchema.safeParse(
        validJob({
          requirements: Array.from({ length: 41 }, (_, index) => ({ text: `Kriteria ${index}` })),
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects category weights that do not total 100', () => {
    const result = createScreeningJobSchema.safeParse(
      validJob({
        categoryWeights: {
          EXPERIENCE: 30,
          TECHNICAL_SKILLS: 25,
          PROJECTS: 20,
          EDUCATION: 5,
          PORTFOLIO: 10,
          OTHER: 0,
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it('accepts a complete job-level category weight configuration', () => {
    const result = createScreeningJobSchema.safeParse(
      validJob({ categoryWeights: EXAMPLE_CATEGORY_WEIGHTS }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range requirement weight and a too-short criterion', () => {
    expect(
      createScreeningJobSchema.safeParse(validJob({ requirements: [{ text: 'ab' }] })).success,
    ).toBe(false);
    expect(
      createScreeningJobSchema.safeParse(
        validJob({ requirements: [{ text: 'Kriteria valid', weight: 101 }] }),
      ).success,
    ).toBe(false);
  });

  it('rejects a title or description that is too short', () => {
    expect(createScreeningJobSchema.safeParse(validJob({ title: 'ab' })).success).toBe(false);
    expect(
      createScreeningJobSchema.safeParse(validJob({ description: 'terlalu pendek' })).success,
    ).toBe(false);
  });

  it('allows cancelling and nothing else', () => {
    expect(screeningJobStateUpdateSchema.safeParse({ state: 'CANCELLED' }).success).toBe(true);
    expect(screeningJobStateUpdateSchema.safeParse({ state: 'COMPLETED' }).success).toBe(false);
  });
});

describe('batch upload contract', () => {
  const JOB = {
    id: 'job_1',
    title: 'Backend Engineer',
    state: 'QUEUED',
    totalCandidates: 1,
    queuedCandidates: 1,
    processingCandidates: 0,
    completedCandidates: 0,
    failedCandidates: 0,
    creditsReserved: 1,
    creditsCharged: 0,
    categoryWeights: null,
    scoringConfigurationVersion: 'scoring-v1',
    preferenceVersion: 0,
    createdAt: '2026-09-26T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
  };

  const CANDIDATE = {
    id: 'cand_1',
    candidateName: 'Andi Pratama',
    fileName: 'andi-pratama.pdf',
    fileSizeBytes: 2048,
    state: 'QUEUED',
    attempts: 0,
    pageCount: 1,
    score: null,
    eligibilityStatus: null,
    verificationStatus: 'NOT_CHECKED',
    failureReason: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
  };

  it('accepts a partial-success batch result', () => {
    const parsed = screeningBatchUploadResultSchema.safeParse({
      job: JOB,
      accepted: [CANDIDATE],
      rejected: [
        { fileName: 'catatan.txt', code: 'UNSUPPORTED_FILE', message: 'Hanya berkas PDF.' },
      ],
      acceptedCount: 1,
      rejectedCount: 1,
      creditsReserved: 1,
      reservationId: 'res_1',
    });

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('keeps the extracted CV text out of the candidate wire format', () => {
    const parsed = screeningCandidateListSchema.safeParse({
      items: [CANDIDATE],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(parsed.success).toBe(true);
    expect(Object.keys(CANDIDATE)).not.toContain('cvText');
    expect(Object.keys(CANDIDATE)).not.toContain('textHash');
  });

  it('rejects a rejection code outside the shared error vocabulary', () => {
    const parsed = screeningBatchUploadResultSchema.safeParse({
      job: JOB,
      accepted: [],
      rejected: [{ fileName: 'x.pdf', code: 'NOT_A_REAL_CODE', message: 'nope' }],
      acceptedCount: 0,
      rejectedCount: 1,
      creditsReserved: 0,
      reservationId: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects negative counters and an unknown candidate state', () => {
    expect(
      screeningBatchUploadResultSchema.safeParse({
        job: JOB,
        accepted: [],
        rejected: [],
        acceptedCount: -1,
        rejectedCount: 0,
        creditsReserved: 0,
        reservationId: null,
      }).success,
    ).toBe(false);

    expect(
      screeningCandidateListSchema.safeParse({
        items: [{ ...CANDIDATE, state: 'DONE' }],
        page: 1,
        pageSize: 20,
        total: 1,
      }).success,
    ).toBe(false);
  });
});

describe('candidate label derivation', () => {
  it('derives a readable label from the file name and nothing else', () => {
    expect(candidateNameFromFileName('andi-pratama.pdf')).toBe('andi pratama');
    expect(candidateNameFromFileName('Budi_Santoso.CV.pdf')).toBe('Budi Santoso CV');
    expect(candidateNameFromFileName('kandidat 01.pdf')).toBe('kandidat 01');
  });

  it('falls back to a neutral label when the name carries no information', () => {
    expect(candidateNameFromFileName('.pdf')).toBe('Kandidat');
    expect(candidateNameFromFileName('   ')).toBe('Kandidat');
  });
});
