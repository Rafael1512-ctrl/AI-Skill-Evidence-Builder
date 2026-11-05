import { useState } from 'react';
import { BrainCircuit } from 'lucide-react';

import {
  DEFAULT_FEATURE_PRICING,
  FEATURE_KEYS,
  formatDateTimeId,
  formatNumber,
} from '@aseb/shared';

import { useAdminAiUsageQuery } from '../../lib/admin.js';
import { AdminEmpty, AdminError, AdminPageHeader, AdminPagination, AdminPanel } from './AdminUi.js';

export function AdminAiUsagePage() {
  const [feature, setFeature] = useState('');
  const [page, setPage] = useState(1);
  const usage = useAdminAiUsageQuery({ feature: feature || undefined, page, pageSize: 20 });

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Provider cost"
        title="Pemakaian AI terperinci"
        description="Biaya provider dan jumlah token bersifat internal. Untuk angka per bulan, gunakan halaman laporan."
      />

      <AdminPanel
        title="Panggilan model terbaru"
        description="Setiap baris adalah catatan penggunaan untuk analisis biaya dan margin."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <BrainCircuit aria-hidden className="h-4 w-4 text-[var(--color-content-muted)]" />
            <span className="sr-only">Filter fitur AI</span>
            <select
              value={feature}
              onChange={(event) => {
                setFeature(event.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              <option value="">Semua fitur</option>
              {FEATURE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {DEFAULT_FEATURE_PRICING[key].label}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {usage.isPending ? <p className="px-5 py-8 text-sm">Memuat pemakaian AI…</p> : null}
        {usage.isError ? (
          <div className="p-4">
            <AdminError error={usage.error} />
          </div>
        ) : null}
        {usage.data?.usage.items.length === 0 ? (
          <AdminEmpty>Tidak ada pemakaian AI yang cocok.</AdminEmpty>
        ) : null}
        {usage.data && usage.data.usage.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Waktu</th>
                  <th className="px-5 py-3 font-medium">Fitur</th>
                  <th className="px-5 py-3 font-medium">Model</th>
                  <th className="px-5 py-3 font-medium">Permintaan</th>
                  <th className="px-5 py-3 font-medium">Token</th>
                  <th className="px-5 py-3 font-medium">Biaya</th>
                  <th className="px-5 py-3 font-medium">Kredit</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {usage.data.usage.items.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                      {formatDateTimeId(row.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      <span className="block font-medium">{row.feature}</span>
                      <span className="block text-xs text-[var(--color-content-muted)]">
                        {row.promptVersion ?? 'tanpa prompt version'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="block">{row.model}</span>
                      <span className="block text-xs text-[var(--color-content-muted)]">
                        {row.provider}
                      </span>
                    </td>
                    <td className="px-5 py-3">{formatNumber(row.requestCount)}</td>
                    <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                      {formatNumber(row.inputTokens)} masuk
                      <span className="block">{formatNumber(row.outputTokens)} keluar</span>
                      <span className="block">{formatNumber(row.cachedTokens)} cached</span>
                    </td>
                    <td className="px-5 py-3">
                      {row.estimatedCostUsd === null ? '—' : `$${row.estimatedCostUsd.toFixed(4)}`}
                      <span className="block text-xs text-[var(--color-content-muted)]">
                        target{' '}
                        {row.targetRevenueUsd === null
                          ? '—'
                          : `$${row.targetRevenueUsd.toFixed(4)}`}
                      </span>
                    </td>
                    <td className="px-5 py-3">{formatNumber(row.creditsCharged)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          row.success
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-500/10 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {row.success ? 'SUCCESS' : 'FAILED'}
                      </span>
                      {row.latencyMs !== null ? (
                        <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
                          {formatNumber(row.latencyMs)} ms
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {usage.data ? (
          <AdminPagination
            page={usage.data.usage.page}
            pageSize={usage.data.usage.pageSize}
            total={usage.data.usage.total}
            onChange={setPage}
          />
        ) : null}
      </AdminPanel>
    </div>
  );
}
