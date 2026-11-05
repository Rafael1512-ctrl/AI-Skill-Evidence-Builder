import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { LIMITS, formatDateTimeId, formatNumber } from '@aseb/shared';

import { AuditResultView } from '../components/AuditResultView.js';
import { ApiError } from '../lib/api.js';
import { useAuditCvMutation, useAuditJobQuery, useAuditUsageQuery } from '../lib/cvAudit.js';

const MAX_PDF_MB = Math.round(LIMITS.MAX_PDF_BYTES / (1024 * 1024));

export function AuditPage() {
  const fileInputId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const auditId = searchParams.get('auditId');
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const audit = useAuditCvMutation();
  const job = useAuditJobQuery(auditId);
  const usage = useAuditUsageQuery();
  const paidOnly = usage.data?.freeAuditsRemaining === 0;
  const insufficientCredits =
    paidOnly &&
    usage.data !== undefined &&
    usage.data.availableCredits < usage.data.paidAuditCredits;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setLocalError(null);

    if (selected && !/\.pdf$/i.test(selected.name)) {
      setFile(null);
      setLocalError('Berkas harus berupa PDF.');
      return;
    }
    if (selected && selected.size > LIMITS.MAX_PDF_BYTES) {
      setFile(null);
      setLocalError(`Ukuran berkas melebihi ${MAX_PDF_MB} MB.`);
      return;
    }
    setFile(selected);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      // Keep a more specific message (wrong type, too large) if one is already shown.
      setLocalError((current) => current ?? 'Pilih berkas PDF terlebih dahulu.');
      return;
    }
    setLocalError(null);
    audit.mutate(file, {
      onSuccess: (created) => {
        setFile(null);
        const next = new URLSearchParams(searchParams);
        next.set('auditId', created.auditId);
        setSearchParams(next);
      },
    });
  }

  const activeJob =
    job.data?.status === 'QUEUED' || job.data?.status === 'PROCESSING' ? job.data : null;
  const errorMessage =
    localError ??
    (audit.isError ? audit.error.message : null) ??
    (job.isError ? job.error.message : null) ??
    job.data?.failure?.message ??
    null;
  const errorHint =
    !localError && audit.error instanceof ApiError
      ? `Kode: ${audit.error.code}`
      : job.data?.failure
        ? `Kode: ${job.data.failure.code}`
        : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Pencari Kerja
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit CV</h1>
        <p className="mt-2 text-[var(--color-content-muted)]">
          Unggah CV berbahasa apa pun dalam format PDF. Setiap akun mendapat lima audit gratis per
          hari. Setelah kuota habis, audit berikutnya memakai kredit sesuai harga yang berlaku. AI
          hanya membaca isi CV Anda — tidak ada pengalaman, keahlian, atau angka yang ditambahkan.
        </p>
      </div>

      <section
        aria-labelledby="audit-quota-heading"
        className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5"
      >
        <h2 id="audit-quota-heading" className="text-base font-medium">
          Kuota audit hari ini
        </h2>
        {usage.isPending ? (
          <p className="mt-2 text-sm text-[var(--color-content-muted)]">Memuat kuota…</p>
        ) : null}
        {usage.isError ? (
          <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
            Kuota audit tidak dapat dimuat. Anda tetap dapat mencoba mengunggah CV.
          </p>
        ) : null}
        {usage.data ? (
          <>
            <p className="mt-2 text-sm">
              <strong>{usage.data.freeAuditsRemaining}</strong> dari {usage.data.freeAuditsLimit}{' '}
              audit gratis tersisa hari ini.
            </p>
            <p className="mt-1 text-sm text-[var(--color-content-muted)]">
              Kuota diperbarui {formatDateTimeId(usage.data.resetsAt)}. Setelah habis, setiap audit
              berbiaya {formatNumber(usage.data.paidAuditCredits)} kredit. Saldo tersedia:{' '}
              {formatNumber(usage.data.availableCredits)} kredit.
            </p>
            {insufficientCredits ? (
              <p className="mt-2 text-sm text-[var(--color-danger)]">
                Kredit tidak cukup untuk audit tambahan.{' '}
                <Link to="/credits" className="font-medium underline">
                  Isi saldo terlebih dahulu
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5"
      >
        <label htmlFor={fileInputId} className="text-sm font-medium">
          Berkas CV (PDF, maksimal {MAX_PDF_MB} MB)
        </label>
        <input
          id={fileInputId}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          className="w-full cursor-pointer rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-[var(--color-surface-muted)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-content)] file:transition-colors hover:file:bg-[var(--color-border-subtle)]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={audit.isPending || activeJob !== null}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-contrast)] disabled:opacity-60"
          >
            {audit.isPending || activeJob
              ? 'Audit sedang diproses…'
              : paidOnly && usage.data
                ? `Audit CV · ${formatNumber(usage.data.paidAuditCredits)} Kredit`
                : 'Audit CV'}
          </button>
          <span className="text-xs text-[var(--color-content-muted)]">
            {paidOnly && usage.data
              ? `${formatNumber(usage.data.paidAuditCredits)} kredit per audit`
              : 'Gratis selama kuota harian tersedia'}
          </span>
        </div>
      </form>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-[var(--color-danger)]/50 p-4 text-sm"
        >
          <p className="font-medium text-[var(--color-danger)]">{errorMessage}</p>
          {errorHint ? (
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">{errorHint}</p>
          ) : null}
        </div>
      ) : null}

      {audit.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          Mengunggah dan menyiapkan audit…
        </p>
      ) : null}

      {job.isPending && auditId ? (
        <p className="text-sm text-[var(--color-content-muted)]">Memuat status audit…</p>
      ) : null}

      {activeJob ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          {activeJob.status === 'QUEUED'
            ? 'Audit menunggu antrean. Halaman ini dapat di-refresh; proses tetap berjalan.'
            : 'Audit sedang berjalan di latar belakang. Halaman ini dapat di-refresh.'}
        </p>
      ) : null}

      {job.data?.status === 'COMPLETED' && job.data.result && job.data.billing ? (
        <>
          <AuditResultView result={job.data.result} />
          <p className="text-sm text-[var(--color-content-muted)]">
            {job.data.billing.mode === 'FREE'
              ? `Audit ini memakai kuota gratis (${job.data.billing.freeAuditsUsed}/${job.data.billing.freeAuditsLimit} hari ini).`
              : `Audit ini memakai ${formatNumber(job.data.billing.creditsCharged)} kredit.`}
          </p>
        </>
      ) : null}

      <p className="text-sm text-[var(--color-content-muted)]">
        Ingin memperbaiki CV ini tanpa menambah fakta?{' '}
        <Link to="/enhance" className="font-medium text-[var(--color-brand)]">
          Sempurnakan CV
        </Link>
      </p>
      <Link
        to="/audit/history"
        className="w-fit rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-contrast)]"
      >
        Lihat riwayat audit
      </Link>
    </div>
  );
}
