import {
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

import {
  CV_TEMPLATES,
  LIMITS,
  formatDateTimeId,
  type CvEnhancementDetail,
  type CvEnhancementOptions,
  type CvTemplateKey,
} from '@aseb/shared';

import { ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { usePricingQuery } from '../lib/credits.js';
import { useEnhanceCvMutation } from '../lib/cvEnhance.js';
import { downloadBase64Pdf, useExportCvMutation } from '../lib/cvExport.js';
import { TestimonialForm } from './TestimonialsPage.js';

const MAX_PDF_MB = Math.round(LIMITS.MAX_PDF_BYTES / (1024 * 1024));

interface EnhanceForm {
  targetPosition: string;
  targetCareer: string;
  githubUrl: string;
  linkedinUrl: string;
  portfolioUrl: string;
  additionalNotes: string;
  templateKey: CvTemplateKey;
  useProfileContext: boolean;
}

const INITIAL_FORM: EnhanceForm = {
  targetPosition: '',
  targetCareer: '',
  githubUrl: '',
  linkedinUrl: '',
  portfolioUrl: '',
  additionalNotes: '',
  templateKey: 'ATS_MINIMAL',
  useProfileContext: false,
};

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-[var(--color-content-muted)]">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  'rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm';

function text(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
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

function AfterView({ enhancement }: { enhancement: CvEnhancementDetail }) {
  const document = enhancement.document;
  if (!document) {
    return <p className="text-[var(--color-content-muted)]">Dokumen belum tersedia.</p>;
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-lg font-semibold">{document.fullName}</p>
        <p className="text-[var(--color-content-muted)]">{text(document.headline)}</p>
      </div>

      <div>
        <h4 className="font-medium">Ringkasan Profesional</h4>
        <p className="mt-1">{document.professionalSummary}</p>
      </div>

      {document.experience.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h4 className="font-medium">Pengalaman</h4>
          {document.experience.map((item) => (
            <div key={`${item.company}-${item.jobTitle}`}>
              <p className="font-medium">
                {item.jobTitle} · {item.company}
              </p>
              {item.summary ? (
                <p className="text-[var(--color-content-muted)]">{item.summary}</p>
              ) : null}
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {item.bullets.map((bullet, index) => (
                  <li key={`${item.company}-${index}`}>
                    {bullet.text}
                    {bullet.sourceQuote ? (
                      <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">
                        Kutipan sumber: “{bullet.sourceQuote}”
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">
                        Perbaikan gaya (tanpa kutipan sumber).
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {document.projects.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h4 className="font-medium">Proyek</h4>
          {document.projects.map((project) => (
            <div key={project.name}>
              <p className="font-medium">{project.name}</p>
              {project.description ? <p>{project.description}</p> : null}
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {project.bullets.map((bullet, index) => (
                  <li key={`${project.name}-${index}`}>{bullet.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h4 className="font-medium">Keahlian</h4>
        <p className="mt-1">
          Teknis: {document.skills.technical.join(', ') || '—'} · Tools:{' '}
          {document.skills.tools.join(', ') || '—'} · Soft skills:{' '}
          {document.skills.soft.join(', ') || '—'}
        </p>
      </div>

      <div>
        <h4 className="font-medium">Perubahan</h4>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          {document.changeLog.map((entry, index) => (
            <li key={`${entry.section}-${index}`}>
              <span className="font-medium">{entry.section}</span> — {entry.description}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="font-medium">Informasi yang perlu Anda lengkapi</h4>
        <BulletList
          items={document.missingInformation.map((item) => `${item.section}: ${item.message}`)}
          empty="Tidak ada informasi yang hilang."
        />
      </div>

      <p className="text-xs text-[var(--color-content-muted)]">
        Skor kesiapan ATS setelah penyempurnaan: {document.atsReadinessScore}/100. Skor ini adalah
        metrik analisis platform, bukan ukuran universal.
      </p>
    </div>
  );
}

function ResultView({ enhancement }: { enhancement: CvEnhancementDetail }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
        <h2 className="text-lg font-medium">Peningkatan selesai</h2>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {enhancement.creditsCharged} kredit · template {enhancement.templateKey} ·{' '}
          {formatDateTimeId(enhancement.completedAt ?? enhancement.createdAt)} · versi prompt{' '}
          {enhancement.promptVersion}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
          <h3 className="text-base font-medium">Sebelum — CV yang Anda unggah</h3>
          <pre className="mt-3 max-h-[32rem] overflow-auto text-xs whitespace-pre-wrap text-[var(--color-content-muted)]">
            {enhancement.originalText}
          </pre>
        </section>
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
          <h3 className="text-base font-medium">Sesudah — hasil penyempurnaan</h3>
          <div className="mt-3">
            <AfterView enhancement={enhancement} />
          </div>
        </section>
      </div>

      <ExportPanel enhancement={enhancement} />
    </section>
  );
}

/**
 * PDF export for a completed enhancement.
 *
 * The template can be changed here without re-running the model: only the layout of the
 * already-stored document changes. The download is triggered as soon as the API returns
 * the rendered bytes.
 */
function ExportPanel({ enhancement }: { enhancement: CvEnhancementDetail }) {
  const prefix = useId();
  const [templateKey, setTemplateKey] = useState<CvTemplateKey>(enhancement.templateKey);
  const pricing = usePricingQuery();
  const exportMutation = useExportCvMutation();

  const price = pricing.data?.find((entry) => entry.feature === 'CV_PDF_EXPORT');
  const priceLabel = price ? `${price.credits} kredit` : 'sesuai daftar harga';
  const exported = exportMutation.data;

  useEffect(() => {
    if (exported) downloadBase64Pdf(exported);
  }, [exported]);

  const shortOnCredits =
    exportMutation.error instanceof ApiError &&
    exportMutation.error.code === 'INSUFFICIENT_CREDITS';

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
      <h3 className="text-base font-medium">Ekspor PDF</h3>
      <p className="mt-1 text-sm text-[var(--color-content-muted)]">
        Pilih template, lalu unduh CV yang sudah disempurnakan. Isi CV tidak berubah — hanya tata
        letaknya.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${prefix}-export-template`} className="text-sm font-medium">
            Template
          </label>
          <select
            id={`${prefix}-export-template`}
            value={templateKey}
            onChange={(event) => setTemplateKey(event.target.value as CvTemplateKey)}
            className={inputClass}
          >
            {CV_TEMPLATES.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => exportMutation.mutate({ enhancementId: enhancement.id, templateKey })}
          disabled={exportMutation.isPending}
          className="rounded-lg border border-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand)] disabled:opacity-60"
        >
          {exportMutation.isPending ? 'Membuat PDF…' : 'Unduh PDF'}
        </button>
        <span className="text-xs text-[var(--color-content-muted)]">{priceLabel} per unduhan</span>
      </div>

      {exported ? (
        <p className="mt-3 text-sm" role="status">
          {exported.fileName} · {exported.pageCount} halaman · {exported.creditsCharged} kredit
        </p>
      ) : null}

      {exportMutation.isError ? (
        <div role="alert" className="mt-3 text-sm">
          <p className="font-medium text-[var(--color-danger)]">{exportMutation.error.message}</p>
          {shortOnCredits ? (
            <Link to="/credits" className="mt-1 inline-block font-medium text-[var(--color-brand)]">
              Lihat paket kredit
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function EnhancePage() {
  const { status } = useAuth();
  const prefix = useId();
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [form, setForm] = useState<EnhanceForm>(INITIAL_FORM);
  const enhance = useEnhanceCvMutation();
  const pricing = usePricingQuery();

  const price = pricing.data?.find((entry) => entry.feature === 'CV_ENHANCEMENT');
  const priceLabel = price ? `${price.credits} kredit` : 'biaya kredit sesuai daftar harga';

  function update<K extends keyof EnhanceForm>(key: K, value: EnhanceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

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
      setLocalError((current) => current ?? 'Pilih berkas PDF terlebih dahulu.');
      return;
    }
    setLocalError(null);

    const options: CvEnhancementOptions = {
      templateKey: form.templateKey,
      useProfileContext: form.useProfileContext,
      ...(form.targetPosition.trim() ? { targetPosition: form.targetPosition.trim() } : {}),
      ...(form.targetCareer.trim() ? { targetCareer: form.targetCareer.trim() } : {}),
      ...(form.githubUrl.trim() ? { githubUrl: form.githubUrl.trim() } : {}),
      ...(form.linkedinUrl.trim() ? { linkedinUrl: form.linkedinUrl.trim() } : {}),
      ...(form.portfolioUrl.trim() ? { portfolioUrl: form.portfolioUrl.trim() } : {}),
      ...(form.additionalNotes.trim() ? { additionalNotes: form.additionalNotes.trim() } : {}),
    };

    enhance.mutate({ file, options });
  }

  const errorMessage = localError ?? (enhance.isError ? enhance.error.message : null);
  const errorHint =
    !localError && enhance.error instanceof ApiError ? `Kode: ${enhance.error.code}` : null;
  const shortOnCredits =
    enhance.error instanceof ApiError && enhance.error.code === 'INSUFFICIENT_CREDITS';

  if (status !== 'signed-in') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-4 px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Peningkatan CV Berbayar</h1>
        <p className="text-[var(--color-content-muted)]">
          Masuk terlebih dahulu untuk menyempurnakan CV. Setiap penyempurnaan memakai kredit dari
          dompet Anda.
        </p>
        <Link to="/signin" className="font-medium text-[var(--color-brand)]">
          Masuk atau daftar
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Pencari Kerja
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Peningkatan CV</h1>
        <p className="mt-2 text-[var(--color-content-muted)]">
          AI menyempurnakan kalimat, struktur, dan kata kunci ATS tanpa menambah pengalaman,
          keahlian, angka, atau tanggal yang tidak ada di CV Anda. Setiap poin yang berasal dari CV
          menyertakan kutipan sumbernya.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5"
      >
        <Field id={`${prefix}-file`} label={`Berkas CV (PDF, maksimal ${MAX_PDF_MB} MB)`}>
          <input
            id={`${prefix}-file`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            className="text-sm"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${prefix}-position`} label="Posisi target" hint="Opsional.">
            <input
              id={`${prefix}-position`}
              value={form.targetPosition}
              onChange={(event) => update('targetPosition', event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id={`${prefix}-career`} label="Bidang karier target" hint="Opsional.">
            <input
              id={`${prefix}-career`}
              value={form.targetCareer}
              onChange={(event) => update('targetCareer', event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id={`${prefix}-linkedin`}
            label="LinkedIn"
            hint="Opsional, ditampilkan apa adanya."
          >
            <input
              id={`${prefix}-linkedin`}
              value={form.linkedinUrl}
              onChange={(event) => update('linkedinUrl', event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id={`${prefix}-github`} label="GitHub" hint="Opsional, ditampilkan apa adanya.">
            <input
              id={`${prefix}-github`}
              value={form.githubUrl}
              onChange={(event) => update('githubUrl', event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id={`${prefix}-portfolio`} label="Portofolio" hint="Opsional.">
            <input
              id={`${prefix}-portfolio`}
              value={form.portfolioUrl}
              onChange={(event) => update('portfolioUrl', event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field id={`${prefix}-template`} label="Template ekspor">
          <select
            id={`${prefix}-template`}
            value={form.templateKey}
            onChange={(event) => update('templateKey', event.target.value as CvTemplateKey)}
            className={inputClass}
          >
            {CV_TEMPLATES.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id={`${prefix}-notes`}
          label="Catatan tambahan"
          hint="Data, bukan instruksi. Jangan meminta AI menambah fakta."
        >
          <textarea
            id={`${prefix}-notes`}
            value={form.additionalNotes}
            onChange={(event) => update('additionalNotes', event.target.value)}
            rows={3}
            className={inputClass}
          />
        </Field>

        <div className="flex items-start gap-2 text-sm">
          <input
            id={`${prefix}-consent`}
            type="checkbox"
            checked={form.useProfileContext}
            onChange={(event) => update('useProfileContext', event.target.checked)}
            className="mt-1"
          />
          <label htmlFor={`${prefix}-consent`}>
            Gunakan data profil saya (nama, headline, lokasi, tautan tersimpan) sebagai konteks.
            <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">
              Tanpa izin ini, data profil tidak dikirim ke AI.
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={enhance.isPending}
            className="rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-contrast)] disabled:opacity-60"
          >
            {enhance.isPending ? 'Menyempurnakan…' : 'Sempurnakan CV'}
          </button>
          <span className="text-xs text-[var(--color-content-muted)]">
            {priceLabel} · dipotong hanya jika berhasil
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
          {shortOnCredits ? (
            <Link to="/credits" className="mt-2 inline-block font-medium text-[var(--color-brand)]">
              Lihat paket kredit
            </Link>
          ) : null}
        </div>
      ) : null}

      {enhance.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          Menyusun ulang CV Anda tanpa menambah fakta…
        </p>
      ) : null}

      {enhance.data ? <ResultView enhancement={enhance.data} /> : null}

      {/* Social proof tied to this finished result; the API keeps it private until moderated. */}
      {enhance.data ? <TestimonialForm enhancementId={enhance.data.id} /> : null}

      <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke beranda
      </Link>
    </main>
  );
}
