import { useState } from 'react';
import { Link } from 'react-router-dom';

import { formatDateTimeId } from '@aseb/shared';

import { useCvHistoryPageQuery } from '../lib/cvHistory.js';

const PAGE_SIZE = 10;

const KIND_LABELS = {
  FREE_AUDIT: 'Audit gratis',
  DEEP_ANALYSIS: 'Audit tambahan',
} as const;

/** The signed-in account's stored audits. The API scopes this list to the session's user. */
export function AuditHistoryPage() {
  const [page, setPage] = useState(1);
  const history = useCvHistoryPageQuery(page, PAGE_SIZE);

  const total = history.data?.totals.analyses ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Pencari Kerja
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Riwayat Audit CV</h1>
        <p className="mt-2 text-[var(--color-content-muted)]">
          Semua audit yang tersimpan di akun Anda. Skor Kesiapan ATS adalah metrik analisis platform
          ini dan menilai dokumen CV, bukan nilai pribadi Anda.
        </p>
      </div>

      {history.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">Memuat riwayat…</p>
      ) : null}

      {history.isError ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          Riwayat audit tidak dapat dimuat.
        </p>
      ) : null}

      {history.data && total === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          Belum ada audit tersimpan.{' '}
          <Link to="/audit" className="font-medium text-[var(--color-brand)]">
            Audit CV sekarang
          </Link>
        </p>
      ) : null}

      {history.data && history.data.analyses.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {history.data.analyses.map((item) => (
            <li key={item.id}>
              <Link
                to={`/audit/history/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-sm hover:border-[var(--color-brand)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.fileName ?? 'CV tanpa nama'}</p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {KIND_LABELS[item.kind]} · {formatDateTimeId(item.createdAt)}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold">
                  {item.atsScore}
                  <span className="text-xs font-normal text-[var(--color-content-muted)]">
                    {' '}
                    / 100
                  </span>
                </p>
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

      <Link to="/audit" 
        className="w-fit rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-[var(--color-brand-contrast)]"
      >
        Kembali ke Audit CV
      </Link>
    </div>
  );
}
