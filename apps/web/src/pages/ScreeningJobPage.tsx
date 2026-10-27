import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  LIMITS,
  formatDateTimeId,
  type BulkVerificationResult,
  type CandidateResult,
  type CandidateVerificationResult,
  type CriterionResult,
  type EligibilityStatus,
  type EvidenceStatus,
  type ScreeningJobState,
} from '@aseb/shared';

import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { usePricingQuery, useWalletQuery } from '../lib/credits.js';
import {
  useScreeningJobQuery,
  useScreeningProgressQuery,
  useScreeningResultsQuery,
  useScreeningReportsQuery,
  useUploadCandidatesMutation,
  useCancelScreeningJobMutation,
  useExportScreeningReportMutation,
  useVerificationEstimateQuery,
  useVerifyCandidateEvidenceMutation,
  useVerifyAllCandidatesMutation,
  downloadBase64Report,
} from '../lib/screening.js';
import { ScreeningStateBadge } from './ScreeningPage.js';

const TERMINAL: readonly ScreeningJobState[] = [
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
];

const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  HIGH_MATCH: 'Sesuai',
  CONSIDER: 'Perlu dipertimbangkan',
  LOW_MATCH: 'Kurang sesuai',
  REQUIREMENT_NOT_MET: 'Syarat wajib belum terpenuhi',
};

const STATUS_LABELS: Record<EvidenceStatus, string> = {
  FOUND: 'Bukti ditemukan',
  NOT_FOUND: 'Bukti tidak ditemukan',
  UNCERTAIN: 'Perlu ditinjau',
};

/** Which verification the confirmation dialog is currently asking about. */
type VerificationTarget =
  { kind: 'single'; candidateId: string; candidateName: string } | { kind: 'bulk' };

/** One line describing what an individual verification did, shown in the notice area. */
function individualVerificationNotice(verification: CandidateVerificationResult): string {
  if (verification.disabled) return 'Verifikasi bukti sedang dinonaktifkan.';
  return `Status verifikasi: ${verification.verificationStatus} (${verification.creditsCharged} kredit).`;
}

/** One line summarising a bulk run: how many of the eligible candidates were actually billed. */
function bulkVerificationNotice(result: BulkVerificationResult): string {
  if (result.eligibleCount === 0) {
    return 'Tidak ada kandidat yang perlu diverifikasi.';
  }
  return `Verifikasi selesai: ${result.verifiedCount} dari ${result.eligibleCount} kandidat (${result.creditsCharged} kredit).`;
}

/** "Kredit sebelum / sesudah" preview shown inside the confirmation dialog. */
function BalancePreview({ available, cost }: { available: number | null; cost: number }) {
  if (available === null) return null;
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-content-muted)]">
      <div className="flex gap-1">
        <dt>Kredit sebelum</dt>
        <dd className="font-medium">{available}</dd>
      </div>
      <div className="flex gap-1">
        <dt>Kredit sesudah</dt>
        <dd className="font-medium">{Math.max(0, available - cost)}</dd>
      </div>
    </dl>
  );
}

function EligibilityBadge({ status }: { status: EligibilityStatus | null }) {
  if (!status)
    return <span className="text-xs text-[var(--color-content-muted)]">belum dinilai</span>;
  return (
    <span
      className={
        status === 'REQUIREMENT_NOT_MET'
          ? 'rounded-full border border-amber-500 px-2 py-0.5 text-xs font-medium text-amber-700'
          : 'rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs font-medium'
      }
    >
      {ELIGIBILITY_LABELS[status]}
    </span>
  );
}

function CriterionRow({ criterion }: { criterion: CriterionResult }) {
  return (
    <li className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{criterion.criterion}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-content-muted)]">
          <span>{criterion.requirementClass}</span>
          {criterion.hardRequirement ? <span className="font-medium">WAJIB</span> : null}
          <span>{STATUS_LABELS[criterion.status]}</span>
          <span>keyakinan {criterion.confidence.toFixed(2)}</span>
          <span>
            nilai {criterion.earnedScore.toFixed(0)} · bobot{' '}
            {(criterion.normalisedWeight * 100).toFixed(1)}%
          </span>
        </span>
      </div>

      {criterion.evidence.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {criterion.evidence.map((item, index) => (
            <li
              key={`${criterion.requirementId}-${index}`}
              className="text-xs text-[var(--color-content-muted)]"
            >
              <span className="italic">“{item.quote}”</span>
              {item.page === null ? null : <> · hal. {item.page}</>}
              {' · '}
              {item.source}
              {item.url ? <> · {item.url}</> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {criterion.notes ? <p className="mt-1 text-xs text-amber-700">{criterion.notes}</p> : null}
    </li>
  );
}

function CandidateCard({
  candidate,
  rank,
  onVerify,
  verifying,
  verifyDisabled,
}: {
  candidate: CandidateResult;
  rank: number;
  onVerify: () => void;
  verifying: boolean;
  verifyDisabled: boolean;
}) {
  const rating = candidate.score === null ? 'belum dinilai' : `${candidate.score}/100`;
  const externalEvidence = [...candidate.githubEvidence, ...candidate.portfolioEvidence];

  return (
    <li className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium">
            #{rank} {candidate.candidateName}
          </span>
          <span className="text-xs text-[var(--color-content-muted)]">
            {candidate.fileName} · {candidate.processingStatus} · verifikasi{' '}
            {candidate.verificationStatus}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold">{rating}</span>
          <EligibilityBadge status={candidate.eligibilityStatus} />
          <button
            type="button"
            className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs font-medium disabled:opacity-60"
            disabled={verifying || verifyDisabled}
            onClick={onVerify}
          >
            {verifying ? 'Memeriksa…' : 'Verifikasi tautan'}
          </button>
        </div>
      </div>

      {candidate.failureReason ? (
        <p className="px-4 pb-2 text-xs text-red-600">{candidate.failureReason}</p>
      ) : null}

      {candidate.summary ? (
        <p className="px-4 pb-2 text-sm text-[var(--color-content-muted)]">{candidate.summary}</p>
      ) : null}

      {candidate.unmetHardRequirements.length > 0 ? (
        <p className="px-4 pb-2 text-xs text-amber-700">
          Syarat wajib belum terpenuhi: {candidate.unmetHardRequirements.join(', ')}. Kandidat tetap
          ditampilkan.
        </p>
      ) : null}

      {externalEvidence.length > 0 ? (
        <div className="px-4 pb-2">
          <p className="text-xs font-medium">Bukti dari tautan publik</p>
          <ul className="mt-1 flex flex-col gap-1">
            {externalEvidence.map((item, index) => (
              <li
                key={`${item.url ?? 'link'}-${index}`}
                className="text-xs text-[var(--color-content-muted)]"
              >
                <span className="italic">“{item.quote}”</span> · {item.source}
                {item.url ? <> · {item.url}</> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {candidate.criteriaResults.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-[var(--color-content-muted)]">
          Belum ada kriteria yang dinilai untuk kandidat ini.
        </p>
      ) : (
        <details className="border-t border-[var(--color-border-subtle)]">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
            Lihat bukti per kriteria ({candidate.criteriaResults.length})
          </summary>
          <ul>
            {candidate.criteriaResults.map((criterion) => (
              <CriterionRow key={criterion.requirementId} criterion={criterion} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/**
 * One screening batch: upload, live progress, ranked evidence and report export.
 *
 * The screen never computes anything: the score, the eligibility and the derived lists come
 * from the API's stored, reproducible result.
 */
export function ScreeningJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const job = useScreeningJobQuery(jobId);
  const detail = job.data?.job;
  const progress = useScreeningProgressQuery(detail);
  const results = useScreeningResultsQuery(
    jobId,
    Boolean(detail) && (detail?.totalCandidates ?? 0) > 0,
  );
  const reports = useScreeningReportsQuery(jobId);
  const upload = useUploadCandidatesMutation(jobId ?? '');
  const cancel = useCancelScreeningJobMutation(jobId ?? '');
  const exportReport = useExportScreeningReportMutation(jobId ?? '');
  const verifyEvidence = useVerifyCandidateEvidenceMutation(jobId ?? '');
  const verifyAll = useVerifyAllCandidatesMutation(jobId ?? '');
  const pricing = usePricingQuery();
  const wallet = useWalletQuery();
  const verificationEstimate = useVerificationEstimateQuery(
    jobId,
    Boolean(detail) && (detail?.totalCandidates ?? 0) > 0,
  );

  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationTarget, setVerificationTarget] = useState<VerificationTarget | null>(null);

  if (job.isPending) {
    return <main className="mx-auto max-w-4xl px-6 py-16 text-sm">Memuat sesi…</main>;
  }
  if (job.isError) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p role="alert" className="text-sm text-red-600">
          {(job.error as Error).message}
        </p>
      </main>
    );
  }
  if (!detail) return null;

  const finished = TERMINAL.includes(detail.state);
  const batch = upload.data;

  // The price is read from the centralized pricing service (admin overrides included), never
  // duplicated here. `available` drops the credits already held by an active reservation.
  const unitCredits =
    pricing.data?.find((item) => item.feature === 'EVIDENCE_VERIFICATION')?.credits ?? null;
  const availableCredits = wallet.data?.available ?? null;
  const estimate = verificationEstimate.data;
  const insufficientForOne =
    unitCredits !== null && availableCredits !== null && availableCredits < unitCredits;
  const bulkBlocked =
    estimate === undefined ||
    estimate.disabled ||
    estimate.eligibleCount === 0 ||
    !estimate.sufficient;
  // The preflight price is authoritative; the price list only fills the gap before it loads.
  const singleUnitCredits = unitCredits ?? estimate?.unitCredits ?? 0;

  async function handleExport(format: 'CSV' | 'PDF'): Promise<void> {
    setNotice(null);
    try {
      const report = await exportReport.mutateAsync(format);
      downloadBase64Report(report);
      setNotice(`Laporan ${format} dibuat: ${report.fileName}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ekspor gagal.');
    }
  }

  function confirmVerification(): void {
    const target = verificationTarget;
    if (!target) return;

    if (target.kind === 'bulk') {
      verifyAll.mutate(undefined, {
        onSuccess: (result) => {
          setVerificationTarget(null);
          setNotice(bulkVerificationNotice(result));
        },
        onError: (error) => {
          setVerificationTarget(null);
          setNotice(error.message);
        },
      });
      return;
    }

    verifyEvidence.mutate(target.candidateId, {
      onSuccess: (verification) => {
        setVerificationTarget(null);
        setNotice(individualVerificationNotice(verification));
      },
      onError: (error) => {
        setVerificationTarget(null);
        setNotice(error.message);
      },
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <Link to="/screening" className="text-sm text-[var(--color-brand)]">
          ← Semua sesi
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.title}</h1>
          <ScreeningStateBadge state={detail.state} />
        </div>
        <p className="text-sm text-[var(--color-content-muted)]">{detail.description}</p>
        <p className="text-xs text-[var(--color-content-muted)]">
          Konfigurasi skor {detail.scoringConfigurationVersion} · versi preferensi{' '}
          {detail.preferenceVersion} · versi prompt {detail.promptVersion}
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
        <h2 className="font-medium">Progres</h2>
        {progress.data ? (
          <>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
              <div
                className="h-full bg-[var(--color-brand)]"
                style={{ width: `${progress.data.progress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-[var(--color-content-muted)]">
              {progress.data.progress.completed} selesai · {progress.data.progress.failed} gagal ·{' '}
              {progress.data.progress.queued} antre · {progress.data.progress.processing} diproses
              {progress.data.progress.partialSuccess ? ' · selesai sebagian' : ''}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm">Belum ada progres.</p>
        )}
      </section>

      {detail.totalCandidates === 0 ? (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
          <h2 className="font-medium">Unggah batch CV</h2>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Hingga {LIMITS.MAX_SCREENING_CVS} PDF, atau satu ZIP. Teks diekstrak saat unggah; PDF
            hasil pindai belum didukung.
          </p>
          <input
            className="mt-3 text-sm"
            type="file"
            multiple
            accept=".pdf,.zip"
            aria-label="Berkas CV"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={files.length === 0 || upload.isPending}
            onClick={() =>
              upload.mutate(files, {
                onSuccess: () => setFiles([]),
                onError: (error) => setNotice(error.message),
              })
            }
          >
            {upload.isPending ? 'Mengunggah…' : `Unggah ${files.length || ''} berkas`}
          </button>
          {upload.isError ? (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {(upload.error as Error).message}
            </p>
          ) : null}
          {batch ? (
            <p className="mt-2 text-sm">
              {batch.acceptedCount} diterima, {batch.rejectedCount} ditolak
              {batch.rejected.length > 0
                ? ` (${batch.rejected.map((item) => `${item.fileName}: ${item.message}`).join('; ')})`
                : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Hasil</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              disabled={bulkBlocked || verifyAll.isPending || detail.totalCandidates === 0}
              onClick={() => setVerificationTarget({ kind: 'bulk' })}
            >
              {verifyAll.isPending ? 'Memverifikasi…' : 'Verifikasi semua'}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              disabled={exportReport.isPending || detail.totalCandidates === 0}
              onClick={() => void handleExport('CSV')}
            >
              Ekspor CSV
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              disabled={exportReport.isPending || detail.totalCandidates === 0}
              onClick={() => void handleExport('PDF')}
            >
              Ekspor PDF
            </button>
            {!finished ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Batalkan
              </button>
            ) : null}
          </div>
        </div>

        {unitCredits !== null ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-content-muted)]">
            <span>Verifikasi tautan: {unitCredits} kredit/kandidat</span>
            {availableCredits !== null ? <span>Saldo: {availableCredits} kredit</span> : null}
            {estimate ? (
              <span>
                {estimate.eligibleCount} kandidat belum diverifikasi · total {estimate.totalCredits}{' '}
                kredit
              </span>
            ) : null}
          </p>
        ) : null}

        {estimate && estimate.eligibleCount > 0 && !estimate.sufficient ? (
          <p role="alert" className="text-sm text-red-600">
            Kredit tidak cukup: butuh {estimate.totalCredits} kredit, tersedia {estimate.available}{' '}
            kredit.
          </p>
        ) : null}

        {estimate?.disabled ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            Verifikasi bukti sedang dinonaktifkan.
          </p>
        ) : null}

        {insufficientForOne && (estimate === undefined || estimate.eligibleCount === 0) ? (
          <p role="alert" className="text-sm text-red-600">
            Kredit tidak cukup untuk verifikasi (butuh {unitCredits} kredit, tersedia{' '}
            {availableCredits} kredit).
          </p>
        ) : null}

        {notice ? <p className="text-sm text-[var(--color-content-muted)]">{notice}</p> : null}
        {results.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(results.error as Error).message}
          </p>
        ) : null}

        {detail.totalCandidates === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            Belum ada kandidat yang diunggah.
          </p>
        ) : results.isPending ? (
          <p className="text-sm">Memuat hasil…</p>
        ) : (results.data?.results.candidates.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">Belum ada hasil.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {results.data?.results.candidates.map((candidate, index) => (
              <CandidateCard
                key={candidate.candidateId}
                candidate={candidate}
                rank={index + 1}
                verifying={
                  verifyEvidence.isPending && verifyEvidence.variables === candidate.candidateId
                }
                verifyDisabled={insufficientForOne}
                onVerify={() =>
                  setVerificationTarget({
                    kind: 'single',
                    candidateId: candidate.candidateId,
                    candidateName: candidate.candidateName,
                  })
                }
              />
            ))}
          </ul>
        )}

        {results.data ? (
          <p className="text-xs text-[var(--color-content-muted)]">
            {results.data.results.methodologyNote}
          </p>
        ) : null}
      </section>

      {reports.data && reports.data.reports.total > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Riwayat laporan</h2>
          <ul className="text-sm">
            {reports.data.reports.items.map((report) => (
              <li key={report.id} className="text-[var(--color-content-muted)]">
                {report.fileName} · {report.format} · {formatDateTimeId(report.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {verificationTarget ? (
        <ConfirmDialog
          open
          title={
            verificationTarget.kind === 'bulk'
              ? 'Konfirmasi verifikasi semua'
              : 'Konfirmasi verifikasi'
          }
          confirmLabel="Lanjutkan"
          busy={verifyAll.isPending || verifyEvidence.isPending}
          confirmDisabled={verificationTarget.kind === 'bulk' ? bulkBlocked : insufficientForOne}
          onCancel={() => setVerificationTarget(null)}
          onConfirm={confirmVerification}
        >
          {verificationTarget.kind === 'bulk' && estimate ? (
            <>
              <p>{estimate.eligibleCount} kandidat belum diverifikasi</p>
              <p>Biaya: {estimate.unitCredits} kredit/kandidat</p>
              <p className="font-medium">Total: {estimate.totalCredits} kredit</p>
              <p>
                Verifikasi {estimate.eligibleCount} kandidat akan menggunakan total{' '}
                {estimate.totalCredits} kredit. Lanjutkan?
              </p>
              <BalancePreview available={availableCredits} cost={estimate.totalCredits} />
            </>
          ) : null}

          {verificationTarget.kind === 'single' ? (
            <>
              <p>Verifikasi kandidat ini akan menggunakan {singleUnitCredits} kredit. Lanjutkan?</p>
              <p className="text-[var(--color-content-muted)]">
                {verificationTarget.candidateName}
              </p>
              <BalancePreview available={availableCredits} cost={singleUnitCredits} />
            </>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </main>
  );
}
