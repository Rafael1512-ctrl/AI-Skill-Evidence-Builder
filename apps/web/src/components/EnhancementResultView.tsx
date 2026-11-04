import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  CV_TEMPLATES,
  formatDateTimeId,
  type CvEnhancementDetail,
  type CvTemplateKey,
} from '@aseb/shared';

import { ApiError } from '../lib/api.js';
import { usePricingQuery } from '../lib/credits.js';
import { downloadBase64Pdf, useExportCvMutation } from '../lib/cvExport.js';

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

/** Before vs After and the PDF export, shared by a fresh result and the stored history detail. */
export function EnhancementResultView({ enhancement }: { enhancement: CvEnhancementDetail }) {
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
          {enhancement.originalText ? (
            <pre className="mt-3 max-h-[32rem] overflow-auto text-xs whitespace-pre-wrap text-[var(--color-content-muted)]">
              {enhancement.originalText}
            </pre>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">
              Teks CV asli sudah dihapus dari akun Anda.
            </p>
          )}
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
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm"
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
