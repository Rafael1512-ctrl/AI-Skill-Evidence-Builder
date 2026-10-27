import { useId, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { LIMITS, formatDateTimeId, formatNumber, type CvAuditResult } from '@aseb/shared';

import { ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useAuditCvMutation } from '../lib/cvAudit.js';

const MAX_PDF_MB = Math.round(LIMITS.MAX_PDF_BYTES / (1024 * 1024));

type KeywordStatus = CvAuditResult['keywordAnalysis'][number]['status'];
type FormattingStatus = CvAuditResult['formattingAnalysis'][number]['status'];
type SuggestionPriority = CvAuditResult['improvementSuggestions'][number]['priority'];

const KEYWORD_LABELS: Record<KeywordStatus, string> = {
  PRESENT: 'Ada',
  PARTIAL: 'Sebagian',
  MISSING: 'Belum ada',
};

const FORMATTING_LABELS: Record<FormattingStatus, string> = {
  GOOD: 'Baik',
  WARNING: 'Perlu perhatian',
  PROBLEM: 'Masalah',
};

const PRIORITY_LABELS: Record<SuggestionPriority, string> = {
  HIGH: 'Prioritas tinggi',
  MEDIUM: 'Prioritas sedang',
  LOW: 'Prioritas rendah',
};

function toneClass(tone: 'good' | 'warn' | 'bad'): string {
  if (tone === 'good') return 'border-[var(--color-border-subtle)] text-[var(--color-content)]';
  if (tone === 'warn') return 'border-amber-400/60 text-amber-700';
  return 'border-[var(--color-danger)]/60 text-[var(--color-danger)]';
}

function Pill({ label, tone }: { label: string; tone: 'good' | 'warn' | 'bad' }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass(tone)}`}>
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
      <h3 className="text-base font-medium">{title}</h3>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function BulletList({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[var(--color-content-muted)]">{empty}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function AuditResultView({ result }: { result: CvAuditResult }) {
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="audit-score-heading"
        className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5"
      >
        <h2 id="audit-score-heading" className="text-lg font-medium">
          Hasil Audit CV
        </h2>
        <p className="mt-3 text-4xl font-semibold tracking-tight">
          {result.atsScore}
          <span className="text-base font-normal text-[var(--color-content-muted)]"> / 100</span>
        </p>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Skor Kesiapan ATS adalah metrik analisis platform ini, bukan ukuran ilmiah yang universal.
          Skor menilai kualitas dokumen CV, bukan nilai pribadi Anda.
        </p>
        <p className="mt-3 text-sm">{result.professionalSummary}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Kekuatan">
          <BulletList items={result.strengths} empty="Belum ada kekuatan yang dapat ditandai." />
        </Section>
        <Section title="Yang perlu diperbaiki">
          <BulletList items={result.weaknesses} empty="Tidak ada catatan perbaikan." />
        </Section>
      </div>

      <Section title="Bagian yang belum ditemukan">
        <BulletList items={result.missingSections} empty="Semua bagian utama sudah terdeteksi." />
      </Section>

      <Section title="Analisis kata kunci">
        {result.keywordAnalysis.length === 0 ? (
          <p className="text-[var(--color-content-muted)]">Belum ada kata kunci yang dianalisis.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {result.keywordAnalysis.map((item) => (
              <li key={item.keyword} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.keyword}</p>
                  {item.note ? (
                    <p className="text-[var(--color-content-muted)]">{item.note}</p>
                  ) : null}
                </div>
                <Pill
                  label={KEYWORD_LABELS[item.status]}
                  tone={
                    item.status === 'PRESENT' ? 'good' : item.status === 'PARTIAL' ? 'warn' : 'bad'
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Format & keterbacaan ATS">
        {result.formattingAnalysis.length === 0 ? (
          <p className="text-[var(--color-content-muted)]">Tidak ada temuan format.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {result.formattingAnalysis.map((item) => (
              <li key={item.aspect} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.aspect}</p>
                  {item.note ? (
                    <p className="text-[var(--color-content-muted)]">{item.note}</p>
                  ) : null}
                </div>
                <Pill
                  label={FORMATTING_LABELS[item.status]}
                  tone={
                    item.status === 'GOOD' ? 'good' : item.status === 'WARNING' ? 'warn' : 'bad'
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Saran perbaikan">
        {result.improvementSuggestions.length === 0 ? (
          <p className="text-[var(--color-content-muted)]">Belum ada saran perbaikan.</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-3 pl-5">
            {result.improvementSuggestions.map((suggestion) => (
              <li key={suggestion.title}>
                <p className="font-medium">{suggestion.title}</p>
                <p className="text-[var(--color-content-muted)]">{suggestion.detail}</p>
                <p className="mt-1 text-xs font-medium">{PRIORITY_LABELS[suggestion.priority]}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Kecocokan peran">
        {result.careerFit.length === 0 ? (
          <p className="text-[var(--color-content-muted)]">
            Belum ada peran yang dapat dicocokkan.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.careerFit.map((item) => (
              <li key={item.role}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{item.role}</p>
                  <p className="text-[var(--color-content-muted)]">{item.fit}%</p>
                </div>
                {item.reason ? (
                  <p className="text-[var(--color-content-muted)]">{item.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] p-4 text-xs text-[var(--color-content-muted)]">
        <p>
          Berkas: {result.extraction.fileName ?? 'CV'} · {result.extraction.pageCount} halaman ·{' '}
          {formatNumber(result.extraction.charCount)} karakter · dianalisis{' '}
          {formatDateTimeId(result.analyzedAt)}
        </p>
        <p className="mt-1">
          Mesin: {result.provider} / {result.model} · versi prompt {result.promptVersion}
        </p>
        <p className="mt-1">
          {result.ephemeral
            ? 'Karena Anda belum masuk, berkas ini diproses di memori dan tidak disimpan.'
            : 'Hasil ini tersimpan di akun Anda.'}
        </p>
      </section>
    </div>
  );
}

export function AuditPage() {
  const { status } = useAuth();
  const fileInputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const audit = useAuditCvMutation();

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
    audit.mutate(file);
  }

  const errorMessage = localError ?? (audit.isError ? audit.error.message : null);
  const errorHint =
    !localError && audit.error instanceof ApiError ? `Kode: ${audit.error.code}` : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Pencari Kerja
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit CV Gratis</h1>
        <p className="mt-2 text-[var(--color-content-muted)]">
          Unggah CV berbahasa apa pun dalam format PDF. Audit ini gratis (0 kredit) dan tidak
          memerlukan akun. AI hanya membaca isi CV Anda — tidak ada pengalaman, keahlian, atau angka
          yang ditambahkan.
        </p>
      </div>

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
          className="text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={audit.isPending}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-contrast)] disabled:opacity-60"
          >
            {audit.isPending ? 'Menganalisis…' : 'Audit CV Gratis'}
          </button>
          <span className="text-xs text-[var(--color-content-muted)]">
            0 kredit · tidak perlu akun
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
          Sedang membaca dan menilai struktur CV Anda…
        </p>
      ) : null}

      {audit.data ? <AuditResultView result={audit.data.result} /> : null}

      <p className="text-sm text-[var(--color-content-muted)]">
        {status === 'signed-in'
          ? 'Ingin memperbaiki CV ini tanpa menambah fakta? '
          : 'Sudah punya akun untuk menyimpan riwayat dan menyempurnakan CV? '}
        <Link
          to={status === 'signed-in' ? '/enhance' : '/signin'}
          className="font-medium text-[var(--color-brand)]"
        >
          {status === 'signed-in' ? 'Sempurnakan CV' : 'Masuk'}
        </Link>
      </p>

      <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke beranda
      </Link>
    </main>
  );
}
