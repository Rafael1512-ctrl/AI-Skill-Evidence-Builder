import type { CandidateResult, CriterionResult, ScreeningJobSummary } from '@aseb/shared';

import { escapeHtml, renderPage } from '../cv/html.js';
import { safeFileName } from '../../utils/text.js';

/**
 * Screening report rendering (Phase 15).
 *
 * Two outputs from one source of truth: a printable HTML document (rendered to PDF by the
 * existing renderer) and CSV rows. EVERY interpolated value is escaped, because candidate
 * names and evidence quotes come from an untrusted CV - a report must never be a way to
 * inject markup into the recruiter's browser or the renderer.
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
  body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; color: #0f172a; font-size: 11pt; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  h2 { font-size: 13pt; margin: 24px 0 8px; }
  p { margin: 4px 0; line-height: 1.45; }
  .muted { color: #475569; font-size: 9.5pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 9.5pt; }
  th { background: #f1f5f9; }
  .badge { display: inline-block; border: 1px solid #0f172a; border-radius: 999px; padding: 1px 7px; font-size: 8.5pt; }
  .candidate { page-break-inside: avoid; margin-top: 18px; }
  .quote { color: #334155; font-style: italic; }
  .notes { color: #7c2d12; }
`;

function statusBadge(criterion: CriterionResult): string {
  return `${criterion.status}${criterion.hardRequirement ? ' / wajib' : ''}`;
}

function evidenceCell(criterion: CriterionResult): string {
  if (criterion.evidence.length === 0) return '-';
  return criterion.evidence
    .map((item) => {
      const page = item.page === null ? '' : ` (hal. ${item.page})`;
      const url = item.url ? ` <span class="muted">${escapeHtml(item.url)}</span>` : '';
      return `<span class="quote">&ldquo;${escapeHtml(item.quote)}&rdquo;</span>${page} <span class="muted">[${escapeHtml(item.source)}]</span>${url}`;
    })
    .join('<br />');
}

function candidateSection(candidate: CandidateResult, rank: number): string {
  const rating = candidate.score === null ? 'belum dinilai' : `${candidate.score}/100`;
  const eligibility = candidate.eligibilityStatus ?? 'belum dinilai';

  const rows = candidate.criteriaResults
    .map(
      (criterion) => `
        <tr>
          <td>${escapeHtml(criterion.criterion)}</td>
          <td>${escapeHtml(criterion.requirementClass)}</td>
          <td><span class="badge">${escapeHtml(statusBadge(criterion))}</span></td>
          <td>${criterion.confidence.toFixed(2)}</td>
          <td>${criterion.earnedScore.toFixed(0)}</td>
          <td>${(criterion.normalisedWeight * 100).toFixed(1)}%</td>
          <td>${evidenceCell(criterion)}</td>
        </tr>`,
    )
    .join('');

  const notes = [
    ...candidate.unmetHardRequirements.map(
      (requirement) =>
        `<p class="notes">Syarat wajib belum terpenuhi: ${escapeHtml(requirement)}</p>`,
    ),
    ...candidate.uncertainties.map(
      (item) => `<p class="notes">Perlu ditinjau (UNCERTAIN): ${escapeHtml(item)}</p>`,
    ),
    ...candidate.gaps.map((item) => `<p class="muted">Tidak ada bukti: ${escapeHtml(item)}</p>`),
  ].join('');

  return `
    <section class="candidate">
      <h2>#${rank} ${escapeHtml(candidate.candidateName)} &mdash; ${escapeHtml(rating)} (${escapeHtml(eligibility)})</h2>
      <p class="muted">
        Berkas: ${escapeHtml(candidate.fileName)}
        &middot; status: ${escapeHtml(candidate.processingStatus)}
        &middot; verifikasi: ${escapeHtml(candidate.verificationStatus)}
      </p>
      ${candidate.summary ? `<p>${escapeHtml(candidate.summary)}</p>` : ''}
      ${notes}
      <table>
        <thead>
          <tr>
            <th>Kriteria</th>
            <th>Kelas</th>
            <th>Status</th>
            <th>Keyakinan</th>
            <th>Nilai</th>
            <th>Bobot</th>
            <th>Bukti</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7">Belum ada kriteria yang dinilai.</td></tr>'}</tbody>
      </table>
    </section>`;
}

export function renderScreeningReportHtml(input: ScreeningReportInput): string {
  const summary = `
    <header>
      <h1>Laporan Screening: ${escapeHtml(input.job.title)}</h1>
      <p class="muted">
        Status batch: ${escapeHtml(input.job.state)}
        &middot; ${String(input.job.totalCandidates)} kandidat
        &middot; ${String(input.job.completedCandidates)} selesai
        &middot; ${String(input.job.failedCandidates)} gagal
        &middot; dibuat ${escapeHtml(input.generatedAt)}
      </p>
      <p class="muted">
        Versi konfigurasi skor ${escapeHtml(input.job.scoringConfigurationVersion)}
        &middot; versi preferensi ${String(input.job.preferenceVersion)}
      </p>
    </header>
    <p>${escapeHtml(input.methodologyNote)}</p>`;

  const candidates = input.candidates.length
    ? input.candidates.map((candidate, index) => candidateSection(candidate, index + 1)).join('')
    : '<p>Belum ada kandidat pada batch ini.</p>';

  return renderPage({
    title: `Laporan Screening: ${input.job.title}`,
    bodyClass: 'screening-report',
    css: REPORT_CSS,
    body: `${summary}${candidates}`,
  });
}

/** RFC 4180-friendly rows; `csv-stringify` handles quoting and escaping. */
export function screeningReportCsvRows(input: ScreeningReportInput): {
  columns: string[];
  rows: string[][];
} {
  const columns = [
    'peringkat',
    'kandidat',
    'berkas',
    'status_proses',
    'skor',
    'kelayakan',
    'verifikasi',
    'kriteria',
    'kelas',
    'wajib',
    'status_bukti',
    'keyakinan',
    'nilai_kriteria',
    'bobot',
    'kutipan',
    'sumber',
    'halaman',
    'url',
    'catatan',
  ];

  const rows: string[][] = [];

  input.candidates.forEach((candidate, index) => {
    const shared = [
      String(index + 1),
      candidate.candidateName,
      candidate.fileName,
      candidate.processingStatus,
      candidate.score === null ? '' : String(candidate.score),
      candidate.eligibilityStatus ?? '',
      candidate.verificationStatus,
    ];

    if (candidate.criteriaResults.length === 0) {
      rows.push([...shared, '', '', '', '', '', '', '', '', '', '', '', '']);
      return;
    }

    for (const criterion of candidate.criteriaResults) {
      const evidence = criterion.evidence.length > 0 ? criterion.evidence : [null];
      for (const item of evidence) {
        rows.push([
          ...shared,
          criterion.criterion,
          criterion.requirementClass,
          criterion.hardRequirement ? 'ya' : 'tidak',
          criterion.status,
          criterion.confidence.toFixed(2),
          criterion.earnedScore.toFixed(2),
          criterion.normalisedWeight.toFixed(5),
          item?.quote ?? '',
          item?.source ?? '',
          item?.page === null || item?.page === undefined ? '' : String(item.page),
          item?.url ?? '',
          criterion.notes,
        ]);
      }
    }
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
