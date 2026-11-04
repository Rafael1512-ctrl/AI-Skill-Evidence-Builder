import { useState } from 'react';
import { Link } from 'react-router-dom';

import { CV_TEMPLATES, formatDateTimeId, type CvHistoryEnhancement } from '@aseb/shared';

import { useCvHistoryPageQuery } from '../lib/cvHistory.js';

const PAGE_SIZE = 10;

const STATUS_LABELS: Record<CvHistoryEnhancement['status'], string> = {
  PENDING: 'Menunggu',
  PROCESSING: 'Diproses',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  REFUNDED: 'Dikembalikan',
};

function statusClass(status: CvHistoryEnhancement['status']): string {
  if (status === 'COMPLETED') return 'border-[var(--color-border-subtle)]';
  if (status === 'FAILED') return 'border-[var(--color-danger)]/60 text-[var(--color-danger)]';
  return 'border-amber-400/60 text-amber-700';
}

function templateName(templateKey: string): string {
  return CV_TEMPLATES.find((template) => template.key === templateKey)?.name ?? templateKey;
}

/** The signed-in account's stored enhancements. The API scopes this list to the session's user. */
export function EnhancementHistoryPage() {
  const [page, setPage] = useState(1);
  const history = useCvHistoryPageQuery(page, PAGE_SIZE);

  const total = history.data?.totals.enhancements ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Pencari Kerja
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Riwayat Peningkatan CV</h1>
        <p className="mt-2 text-[var(--color-content-muted)]">
          Semua peningkatan CV yang tersimpan di akun Anda, termasuk perbandingan sebelum dan
          sesudahnya.
        </p>
      </div>

      {history.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">Memuat riwayat…</p>
      ) : null}

      {history.isError ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          Riwayat peningkatan tidak dapat dimuat.
        </p>
      ) : null}

      {history.data && total === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          Belum ada peningkatan tersimpan.{' '}
          <Link to="/enhance" className="font-medium text-[var(--color-brand)]">
            Sempurnakan CV sekarang
          </Link>
        </p>
      ) : null}

      {history.data && history.data.enhancements.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {history.data.enhancements.map((item) => (
            <li key={item.id}>
              <Link
                to={`/enhance/history/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-sm hover:border-[var(--color-brand)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.fileName ?? 'CV tanpa nama'}</p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {templateName(item.templateKey)} · {item.creditsCharged} kredit ·{' '}
                    {formatDateTimeId(item.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(item.status)}`}
                >
                  {STATUS_LABELS[item.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {history.data && totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-60"
          >
            Sebelumnya
          </button>
          <span className="text-[var(--color-content-muted)]">
            Halaman {page} dari {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-60"
          >
            Berikutnya
          </button>
        </div>
      ) : null}

      <Link to="/enhance" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke Peningkatan CV
      </Link>
    </div>
  );
}
