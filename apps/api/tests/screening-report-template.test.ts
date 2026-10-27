import { describe, expect, it } from 'vitest';

import {
  SCREENING_METHODOLOGY_NOTE,
  candidateResultSchema,
  screeningResultPayloadSchema,
  type CandidateResult,
  type CriterionResult,
} from '@aseb/shared';
import { stringify } from 'csv-stringify/sync';

import {
  renderScreeningReportHtml,
  screeningReportCsvRows,
  screeningReportFileName,
} from '../src/templates/report/screeningReport.js';

/**
 * Report rendering. Pure and offline.
 *
 * The report is the artifact a recruiter forwards to a hiring manager, and every value in
 * it comes from an untrusted CV, so these tests care most about escaping: a candidate name
 * or an evidence quote must never be able to inject markup.
 */

const INJECTION = '<script>alert("x")</script>';

function criterion(overrides: Partial<CriterionResult> = {}): CriterionResult {
  return {
    requirementId: 'req-1',
    criterion: 'Pengalaman minimal 3 tahun dengan Node.js',
    category: 'TECHNICAL_SKILLS',
    requirementClass: 'REQUIRED',
    weight: 30,
    normalisedWeight: 1,
    hardRequirement: true,
    status: 'FOUND',
    verificationStatus: 'NOT_CHECKED',
    confidence: 0.82,
    earnedScore: 100,
    evidence: [
      {
        quote: 'lima tahun pengalaman Node.js, PostgreSQL, dan Docker',
        source: 'CV',
        page: null,
        url: null,
        note: null,
      },
    ],
    notes: '',
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateResult> = {}): CandidateResult {
  const criteriaResults = overrides.criteriaResults ?? [criterion()];
  return candidateResultSchema.parse({
    candidateId: 'cand-1',
    candidateName: 'Andi Pratama',
    fileName: 'andi-pratama.pdf',
    processingStatus: 'COMPLETED',
    score: 100,
    eligibilityStatus: 'HIGH_MATCH',
    criteriaResults,
    requiredCriteria: criteriaResults.filter((item) => item.requirementClass === 'REQUIRED'),
    preferredCriteria: [],
    bonusCriteria: [],
    evidence: criteriaResults.flatMap((item) => item.evidence),
    strengths: ['Pengalaman minimal 3 tahun dengan Node.js'],
    gaps: [],
    uncertainties: [],
    unmetHardRequirements: [],
    portfolioEvidence: [],
    githubEvidence: [],
    verificationStatus: 'NOT_CHECKED',
    summary: 'Bukti ditemukan untuk kriteria utama.',
    generatedAt: '2026-09-26T10:00:00.000Z',
    scoringConfigurationVersion: '1.0.0',
    preferenceVersion: 2,
    failureReason: null,
    ...overrides,
  });
}

function reportInput(candidates: readonly CandidateResult[] = [candidate()]) {
  return {
    job: {
      id: 'job-1',
      title: 'Backend Engineer',
      state: 'COMPLETED' as const,
      totalCandidates: candidates.length,
      queuedCandidates: 0,
      processingCandidates: 0,
      completedCandidates: candidates.length,
      failedCandidates: 0,
      creditsReserved: 0,
      creditsCharged: candidates.length,
      categoryWeights: null,
      scoringConfigurationVersion: '1.0.0',
      preferenceVersion: 2,
      createdAt: '2026-09-26T09:00:00.000Z',
      startedAt: '2026-09-26T09:01:00.000Z',
      completedAt: '2026-09-26T09:05:00.000Z',
    },
    methodologyNote: SCREENING_METHODOLOGY_NOTE,
    candidates,
    generatedAt: '2026-09-26T10:00:00.000Z',
  };
}

describe('screening report HTML', () => {
  it('renders the job, the methodology note and the ranked candidate', () => {
    const html = renderScreeningReportHtml(reportInput());

    expect(html).toContain('Laporan Screening: Backend Engineer');
    expect(html).toContain(SCREENING_METHODOLOGY_NOTE);
    expect(html).toContain('#1 Andi Pratama');
    expect(html).toContain('100/100');
    expect(html).toContain('HIGH_MATCH');
    expect(html).toContain('Pengalaman minimal 3 tahun dengan Node.js');
    expect(html).toContain('lima tahun pengalaman Node.js, PostgreSQL, dan Docker');
    expect(html).toContain('Versi konfigurasi skor 1.0.0');
  });

  it('escapes candidate and evidence text so a CV cannot inject markup', () => {
    const html = renderScreeningReportHtml(
      reportInput([
        candidate({
          candidateName: INJECTION,
          fileName: INJECTION,
          summary: INJECTION,
          criteriaResults: [
            criterion({
              criterion: INJECTION,
              evidence: [
                { quote: INJECTION, source: 'CV', page: null, url: INJECTION, note: null },
              ],
            }),
          ],
        }),
      ]),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('labels an unscored or unmet candidate instead of hiding it', () => {
    const html = renderScreeningReportHtml(
      reportInput([
        candidate({
          candidateName: 'Budi',
          score: null,
          eligibilityStatus: 'REQUIREMENT_NOT_MET',
          unmetHardRequirements: ['Wajib punya SIM A'],
          criteriaResults: [criterion({ status: 'NOT_FOUND' })],
        }),
      ]),
    );

    expect(html).toContain('belum dinilai');
    expect(html).toContain('REQUIREMENT_NOT_MET');
    expect(html).toContain('Syarat wajib belum terpenuhi: Wajib punya SIM A');
  });

  it('says so when a batch has no candidates', () => {
    const html = renderScreeningReportHtml(reportInput([]));

    expect(html).toContain('Belum ada kandidat pada batch ini.');
  });
});

describe('screening report CSV', () => {
  it('emits one row per evidence item with the documented columns', () => {
    const { columns, rows } = screeningReportCsvRows(
      reportInput([
        candidate({
          criteriaResults: [
            criterion({
              evidence: [
                { quote: 'bukti satu', source: 'CV', page: null, url: null, note: null },
                { quote: 'bukti dua', source: 'CV', page: null, url: null, note: null },
              ],
            }),
            criterion({ requirementId: 'req-2', status: 'NOT_FOUND', evidence: [] }),
          ],
        }),
      ]),
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]?.[columns.indexOf('kutipan')]).toBe('bukti satu');
    expect(rows[1]?.[columns.indexOf('kutipan')]).toBe('bukti dua');
    // A criterion with no evidence still appears, so the gap is visible in the report.
    expect(rows[2]?.[columns.indexOf('kutipan')]).toBe('');
    expect(rows[2]?.[columns.indexOf('status_bukti')]).toBe('NOT_FOUND');
    expect(rows[0]?.[columns.indexOf('peringkat')]).toBe('1');
    expect(rows[0]?.[columns.indexOf('skor')]).toBe('100');
  });

  it('round-trips commas, quotes and newlines through csv-stringify', () => {
    const tricky = 'Dia menulis "Node.js", PostgreSQL\n dan Docker';
    const { columns, rows } = screeningReportCsvRows(
      reportInput([
        candidate({
          criteriaResults: [
            criterion({
              evidence: [{ quote: tricky, source: 'CV', page: 2, url: null, note: null }],
            }),
          ],
        }),
      ]),
    );

    const csv = stringify(rows, { header: true, columns });
    const parsed = csv.trim().split('\n');

    // The quoted field survives, and the newline stays inside the quoted value.
    expect(csv).toContain('"Dia menulis ""Node.js"", PostgreSQL');
    expect(parsed.length).toBeGreaterThan(2);
    expect(rows[0]?.[columns.indexOf('halaman')]).toBe('2');
  });

  it('lists a candidate with no scored criteria rather than dropping them', () => {
    const { columns, rows } = screeningReportCsvRows(
      reportInput([
        candidate({
          criteriaResults: [],
          score: null,
          eligibilityStatus: null,
          processingStatus: 'QUEUED',
        }),
      ]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.[columns.indexOf('status_proses')]).toBe('QUEUED');
    expect(rows[0]?.[columns.indexOf('skor')]).toBe('');
  });
});

describe('report file names', () => {
  it('builds a safe name per format', () => {
    expect(
      screeningReportFileName({
        jobTitle: 'Backend Engineer (Senior)',
        format: 'CSV',
        generatedAt: '2026-09-26T10:00:00.000Z',
      }),
    ).toBe('laporan-screening-Backend_Engineer_Senior-2026-09-26.csv');

    expect(
      screeningReportFileName({
        jobTitle: '../../etc/passwd',
        format: 'PDF',
        generatedAt: '2026-09-26T10:00:00.000Z',
      }),
    ).toBe('laporan-screening-etc_passwd-2026-09-26.pdf');
  });
});

describe('result payload contract', () => {
  it('accepts the shape the service builds', () => {
    const parsed = screeningResultPayloadSchema.safeParse(reportInput());

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
