import { Link, useParams } from 'react-router-dom';

import { formatDateTimeId, type CvEnhancementDetail } from '@aseb/shared';

import { EnhancementResultView } from '../components/EnhancementResultView.js';
import { ApiError } from '../lib/api.js';
import { useEnhancementDetailQuery } from '../lib/cvHistory.js';

/** Shown instead of a result. `failureReason` is internal, so it is never rendered here. */
function StatusNotice({ status }: { status: CvEnhancementDetail['status'] }) {
  const failed = status === 'FAILED' || status === 'REFUNDED';

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 text-sm">
      <h2 className="text-lg font-medium">
        {failed ? 'Peningkatan tidak berhasil' : 'Peningkatan masih diproses'}
      </h2>
      <p className="mt-1 text-[var(--color-content-muted)]">
        {failed
          ? 'Tidak ada hasil yang tersimpan, dan kredit untuk percobaan ini tidak ditagihkan.'
          : 'Hasilnya akan muncul di sini setelah selesai.'}
      </p>
    </section>
  );
}

/** One stored enhancement, rendered with the same view as a fresh result. */
export function EnhancementDetailPage() {
  const { enhancementId = '' } = useParams();
  const detail = useEnhancementDetailQuery(enhancementId);

  // The API answers 404 for another account's result too, so its existence is never revealed.
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;
  const enhancement = detail.data;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Riwayat Peningkatan CV
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight break-words">
          {enhancement?.fileName ?? 'Detail peningkatan'}
        </h1>
        {enhancement ? (
          <p className="mt-2 text-[var(--color-content-muted)]">
            Dibuat pada {formatDateTimeId(enhancement.createdAt)}
            {enhancement.options.targetPosition
              ? ` · posisi target ${enhancement.options.targetPosition}`
              : ''}
          </p>
        ) : null}
      </div>

      {detail.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">Memuat hasil peningkatan…</p>
      ) : null}

      {detail.isError ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {notFound ? 'Peningkatan ini tidak ditemukan.' : 'Hasil peningkatan tidak dapat dimuat.'}
        </p>
      ) : null}

      {enhancement?.status === 'COMPLETED' ? (
        <EnhancementResultView enhancement={enhancement} />
      ) : null}

      {enhancement && enhancement.status !== 'COMPLETED' ? (
        <StatusNotice status={enhancement.status} />
      ) : null}

      <Link to="/enhance/history" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke riwayat peningkatan
      </Link>
    </div>
  );
}
