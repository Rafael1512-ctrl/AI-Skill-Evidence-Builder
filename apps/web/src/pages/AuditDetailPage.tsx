import { Link, useParams } from 'react-router-dom';

import { formatDateTimeId } from '@aseb/shared';

import { AuditResultView } from '../components/AuditResultView.js';
import { ApiError } from '../lib/api.js';
import { useAuditDetailQuery } from '../lib/cvHistory.js';

/** One stored audit, rendered with the same view as a fresh result. */
export function AuditDetailPage() {
  const { analysisId = '' } = useParams();
  const detail = useAuditDetailQuery(analysisId);

  // The API answers 404 for another account's audit too, so its existence is never revealed.
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
          Riwayat Audit CV
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight break-words">
          {detail.data?.result.extraction.fileName ?? 'Detail audit'}
        </h1>
        {detail.data ? (
          <p className="mt-2 text-[var(--color-content-muted)]">
            Diaudit pada {formatDateTimeId(detail.data.createdAt)}
          </p>
        ) : null}
      </div>

      {detail.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">Memuat hasil audit…</p>
      ) : null}

      {detail.isError ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {notFound ? 'Audit ini tidak ditemukan.' : 'Hasil audit tidak dapat dimuat.'}
        </p>
      ) : null}

      {detail.data ? <AuditResultView result={detail.data.result} /> : null}

      <Link to="/audit/history" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke riwayat audit
      </Link>
    </div>
  );
}
