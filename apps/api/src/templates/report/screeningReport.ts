import {
  formatDateTimeId,
  type CandidateResult,
  type CriterionResult,
  type EligibilityStatus,
  type EvidenceStatus,
  type ScreeningCandidateState,
  type ScreeningJobState,
  type ScreeningJobSummary,
  type VerificationStatus,
} from '@aseb/shared';

import { escapeHtml, renderPage } from '../cv/html.js';
import { safeFileName } from '../../utils/text.js';

/**
 * Screening report rendering (Phase 15).
 *
 * Two outputs from one source of truth: a printable HTML document (rendered to PDF by the
 * existing renderer) and CSV rows, both meant for a hiring manager, so stored codes are shown
 * with the same labels as the screen. EVERY interpolated value is escaped, because candidate
 * names and evidence quotes come from an untrusted CV - a report must never be a way to
 * inject markup into the recruiter's browser or the renderer, or a formula into a spreadsheet.
 */

export interface ScreeningReportInput {
  job: ScreeningJobSummary;
  methodologyNote: string;
  candidates: readonly CandidateResult[];
  generatedAt: string;
}

const REPORT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; color: #0f172a; font-size: 10pt; line-height: 1.45; }
  header { border-bottom: 3px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; }
  .eyebrow { color: #0f766e; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 0; }
  h1 { font-size: 20pt; margin: 2px 0 4px; }
  h2 { font-size: 13pt; margin: 20px 0 6px; }
  h3 { font-size: 11pt; margin: 0; }
  h4 { font-size: 9pt; margin: 8px 0 2px; }
  p { margin: 3px 0; }
  ul { margin: 2px 0; padding-left: 16px; }
  .muted { color: #475569; font-size: 8.5pt; }
  .stats { display: flex; gap: 8px; margin: 12px 0; }
  .stat { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; }
  .stat strong { display: block; font-size: 15pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 8.5pt; }
  th { background: #f1f5f9; border-bottom: 1px solid #94a3b8; }
  .number { text-align: right; white-space: nowrap; }
  .pill { display: inline-block; border-radius: 999px; padding: 1px 7px; font-size: 7.5pt; font-weight: 600; white-space: nowrap; background: #e2e8f0; color: #334155; }
  .pill.good { background: #ccfbf1; color: #115e59; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.bad { background: #fee2e2; color: #991b1b; }
  .candidate { page-break-inside: avoid; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin-top: 10px; }
  .candidate-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .score { font-size: 13pt; font-weight: 700; white-space: nowrap; }
  .quote { color: #334155; font-style: italic; }
  .notes { color: #92400e; }
  .methodology { margin-top: 18px; border-top: 1px solid #cbd5e1; padding-top: 6px; }
`;

const JOB_STATE_LABELS: Record<ScreeningJobState, string> = {
  CREATED: 'Draf',
  VALIDATING: 'Memvalidasi',
  QUEUED: 'Dalam antrean',
  PROCESSING: 'Diproses',
  PARTIALLY_COMPLETED: 'Selesai sebagian',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan',
};

const CANDIDATE_STATE_LABELS: Record<ScreeningCandidateState, string> = {
  QUEUED: 'Dalam antrean',
  PROCESSING: 'Diproses',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
};

const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  HIGH_MATCH: 'Sesuai',
  CONSIDER: 'Perlu dipertimbangkan',
  LOW_MATCH: 'Kurang sesuai',
  REQUIREMENT_NOT_MET: 'Syarat wajib belum terpenuhi',
};

const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  FOUND: 'Bukti ditemukan',
  NOT_FOUND: 'Bukti tidak ditemukan',
  UNCERTAIN: 'Perlu ditinjau',
};

const CLASS_LABELS: Record<CriterionResult['requirementClass'], string> = {
  REQUIRED: 'Wajib',
  PREFERRED: 'Diutamakan',
  BONUS: 'Bonus',
};

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  VERIFIED_EVIDENCE: 'Bukti terverifikasi',
  SUPPORTED: 'Didukung tautan',
  UNVERIFIED: 'Belum terverifikasi',
  CONFLICTING_INFORMATION: 'Informasi perlu ditinjau',
  NOT_CHECKED: 'Belum diperiksa',
};

const ELIGIBILITY_TONES: Record<EligibilityStatus, string> = {
  HIGH_MATCH: 'good',
  CONSIDER: 'warn',
  LOW_MATCH: '',
  REQUIREMENT_NOT_MET: 'bad',
};

const EVIDENCE_TONES: Record<EvidenceStatus, string> = {
  FOUND: 'good',
  NOT_FOUND: 'bad',
  UNCERTAIN: 'warn',
};

const UNSCORED_LABEL = 'Belum dinilai';

function eligibilityPill(status: EligibilityStatus | null): string {
  if (!status) return `<span class="pill">${UNSCORED_LABEL}</span>`;
  return `<span class="pill ${ELIGIBILITY_TONES[status]}">${ELIGIBILITY_LABELS[status]}</span>`;
}

function ratingOf(candidate: CandidateResult): string {
  return candidate.score === null ? 'belum dinilai' : `${candidate.score}/100`;
}

function evidenceCell(criterion: CriterionResult): string {
  if (criterion.evidence.length === 0) return '<span class="muted">Tidak ada kutipan</span>';
  return criterion.evidence
    .map((item) => {
      const page = item.page === null ? '' : ` (hal. ${item.page})`;
      const url = item.url ? ` <span class="muted">${escapeHtml(item.url)}</span>` : '';
      return `<span class="quote">&ldquo;${escapeHtml(item.quote)}&rdquo;</span>${page}${url}`;
    })
    .join('<br />');
}

function listBlock(title: string, items: readonly string[], className = ''): string {
  if (items.length === 0) return '';
  const rows = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<h4>${title}</h4><ul class="${className}">${rows}</ul>`;
}

function candidateSection(candidate: CandidateResult, rank: number): string {
  const rows = candidate.criteriaResults
    .map(
      (criterion) => `
        <tr>
          <td>
            ${escapeHtml(criterion.criterion)}
            <div class="muted">${CLASS_LABELS[criterion.requirementClass]} &middot; keyakinan ${(criterion.confidence * 100).toFixed(0)}%</div>
          </td>
          <td><span class="pill ${EVIDENCE_TONES[criterion.status]}">${EVIDENCE_LABELS[criterion.status]}</span></td>
          <td class="number">${criterion.earnedScore.toFixed(0)}</td>
          <td class="number">${(criterion.normalisedWeight * 100).toFixed(1)}%</td>
          <td>${evidenceCell(criterion)}</td>
        </tr>`,
    )
    .join('');

  return `
    <section class="candidate">
      <div class="candidate-head">
        <h3>#${rank} ${escapeHtml(candidate.candidateName)}</h3>
        <span class="score">${escapeHtml(ratingOf(candidate))}</span>
      </div>
      <p>
        ${eligibilityPill(candidate.eligibilityStatus)}
        <span class="muted">
          ${escapeHtml(candidate.fileName)}
          &middot; ${CANDIDATE_STATE_LABELS[candidate.processingStatus]}
          &middot; tautan: ${VERIFICATION_LABELS[candidate.verificationStatus]}
        </span>
      </p>
      ${candidate.failureReason ? `<p class="notes">Catatan proses: ${escapeHtml(candidate.failureReason)}</p>` : ''}
      ${candidate.summary ? `<p>${escapeHtml(candidate.summary)}</p>` : ''}
      ${listBlock('Syarat wajib belum terpenuhi', candidate.unmetHardRequirements, 'notes')}
      ${listBlock('Kekuatan', candidate.strengths)}
      ${listBlock('Perlu ditinjau', candidate.uncertainties, 'notes')}
      ${listBlock('Belum ada bukti', candidate.gaps)}
      <table>
        <thead>
          <tr>
            <th style="width: 27%">Kriteria</th>
            <th style="width: 19%">Status</th>
            <th style="width: 7%" class="number">Nilai</th>
            <th style="width: 8%" class="number">Bobot</th>
            <th>Bukti dari CV</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5">Belum ada kriteria yang dinilai.</td></tr>'}</tbody>
      </table>
    </section>`;
}

function rankingTable(candidates: readonly CandidateResult[]): string {
  const rows = candidates
    .map(
      (candidate, index) => `
        <tr>
          <td class="number">${index + 1}</td>
          <td>${escapeHtml(candidate.candidateName)}</td>
          <td class="number">${escapeHtml(ratingOf(candidate))}</td>
          <td>${eligibilityPill(candidate.eligibilityStatus)}</td>
          <td>${VERIFICATION_LABELS[candidate.verificationStatus]}</td>
        </tr>`,
    )
    .join('');

  return `
    <h2>Peringkat kandidat</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 6%" class="number">No</th>
          <th>Kandidat</th>
          <th style="width: 11%" class="number">Skor</th>
          <th style="width: 27%">Kelayakan</th>
          <th style="width: 20%">Verifikasi tautan</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><strong>${value}</strong><span class="muted">${label}</span></div>`;
}

export function renderScreeningReportHtml(input: ScreeningReportInput): string {
  const { job, candidates } = input;
  const countOf = (status: EligibilityStatus) =>
    candidates.filter((candidate) => candidate.eligibilityStatus === status).length;

  const summary = `
    <header>
      <p class="eyebrow">Laporan Screening</p>
      <h1>${escapeHtml(job.title)}</h1>
      <p class="muted">
        Status: ${JOB_STATE_LABELS[job.state]}
        &middot; dibuat ${escapeHtml(formatDateTimeId(input.generatedAt))} WIB
      </p>
    </header>
    <div class="stats">
      ${stat('Kandidat', String(job.totalCandidates))}
      ${stat('Selesai dinilai', String(job.completedCandidates))}
      ${stat('Gagal diproses', String(job.failedCandidates))}
    </div>
    <div class="stats">
      ${stat(ELIGIBILITY_LABELS.HIGH_MATCH, String(countOf('HIGH_MATCH')))}
      ${stat(ELIGIBILITY_LABELS.CONSIDER, String(countOf('CONSIDER')))}
      ${stat(ELIGIBILITY_LABELS.LOW_MATCH, String(countOf('LOW_MATCH')))}
      ${stat(ELIGIBILITY_LABELS.REQUIREMENT_NOT_MET, String(countOf('REQUIREMENT_NOT_MET')))}
    </div>`;

  const body = candidates.length
    ? `${rankingTable(candidates)}
       <h2>Detail kandidat</h2>
       ${candidates.map((candidate, index) => candidateSection(candidate, index + 1)).join('')}`
    : '<p>Belum ada kandidat pada batch ini.</p>';

  const methodology = `
    <section class="methodology">
      <p class="muted">${escapeHtml(input.methodologyNote)}</p>
      <p class="muted">
        Versi konfigurasi skor ${escapeHtml(job.scoringConfigurationVersion)}
        &middot; versi preferensi ${String(job.preferenceVersion)}
      </p>
    </section>`;

  return renderPage({
    title: `Laporan Screening: ${job.title}`,
    bodyClass: 'screening-report',
    css: REPORT_CSS,
    body: `${summary}${body}${methodology}`,
  });
}

/** Spreadsheets run a cell starting with these as a formula, and CV text is untrusted. */
function csvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * One row per candidate, ready to sort and filter in a spreadsheet.
 *
 * Each criterion of the batch gets a status column and a quote column, in the order it first
 * appears. A candidate without that criterion, such as one that failed, leaves both empty.
 */
export function screeningReportCsvRows(input: ScreeningReportInput): {
  columns: string[];
  rows: string[][];
} {
  const criteria = new Map<string, string>();
  for (const candidate of input.candidates) {
    for (const criterion of candidate.criteriaResults) {
      if (!criteria.has(criterion.requirementId)) {
        criteria.set(criterion.requirementId, criterion.criterion);
      }
    }
  }

  const columns = [
    'Peringkat',
    'Kandidat',
    'Berkas',
    'Skor',
    'Kelayakan',
    'Status Proses',
    'Verifikasi Tautan',
    'Syarat Wajib Belum Terpenuhi',
    'Ringkasan',
    'Catatan Proses',
    ...[...criteria.values()].flatMap((name) => [
      `Status: ${csvCell(name)}`,
      `Bukti: ${csvCell(name)}`,
    ]),
  ];

  const rows = input.candidates.map((candidate, index) => {
    const byRequirement = new Map(
      candidate.criteriaResults.map((criterion) => [criterion.requirementId, criterion]),
    );

    return [
      String(index + 1),
      csvCell(candidate.candidateName),
      csvCell(candidate.fileName),
      candidate.score === null ? '' : String(candidate.score),
      candidate.eligibilityStatus ? ELIGIBILITY_LABELS[candidate.eligibilityStatus] : UNSCORED_LABEL,
      CANDIDATE_STATE_LABELS[candidate.processingStatus],
      VERIFICATION_LABELS[candidate.verificationStatus],
      csvCell(candidate.unmetHardRequirements.join('; ')),
      csvCell(candidate.summary),
      csvCell(candidate.failureReason ?? ''),
      ...[...criteria.keys()].flatMap((requirementId) => {
        const criterion = byRequirement.get(requirementId);
        if (!criterion) return ['', ''];
        return [
          EVIDENCE_LABELS[criterion.status],
          csvCell(criterion.evidence.map((item) => item.quote).join(' | ')),
        ];
      }),
    ];
  });

  return { columns, rows };
}

/** `laporan-screening-<posisi>-<tanggal>.<ext>`; safe on every filesystem. */
export function screeningReportFileName(input: {
  jobTitle: string;
  format: 'PDF' | 'CSV';
  generatedAt: string;
}): string {
  // Leading/trailing separators look like leftovers (and leading dots look like a path).
  const trimmed = safeFileName(input.jobTitle)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .slice(0, 60);
  const stamp = input.generatedAt.slice(0, 10);
  return `laporan-screening-${trimmed || 'batch'}-${stamp}.${input.format.toLowerCase()}`;
}
