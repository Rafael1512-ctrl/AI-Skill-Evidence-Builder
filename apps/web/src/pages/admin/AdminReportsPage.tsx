import { useState, type FormEvent } from 'react';
import { BrainCircuit, Coins, CreditCard, UsersRound } from 'lucide-react';

import {
  DEFAULT_FEATURE_PRICING,
  FEATURE_KEYS,
  formatCredits,
  formatIdr,
  formatNumber,
} from '@aseb/shared';

import { useAdminReportsQuery, type AdminReportFilters } from '../../lib/admin.js';
import {
  AdminEmpty,
  AdminError,
  AdminMetric,
  AdminPageHeader,
  AdminPagination,
  AdminPanel,
} from './AdminUi.js';

type DraftFilters = Omit<AdminReportFilters, 'page'>;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function lastMonths(months: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - (months - 1), 1);
  return { from: monthKey(from), to: monthKey(to) };
}

function monthLabel(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function initialFilters(): DraftFilters {
  return {
    ...lastMonths(6),
    feature: '',
    search: '',
    sort: 'usage',
    pageSize: 20,
  };
}

export function AdminReportsPage() {
  const [draft, setDraft] = useState<DraftFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AdminReportFilters>(() => ({
    ...initialFilters(),
    page: 1,
  }));
  const report = useAdminReportsQuery(filters);

  function applyFilters(event?: FormEvent) {
    event?.preventDefault();
    setPage(1);
    setFilters({ ...draft, page: 1 });
  }

  function chooseRange(months: number) {
    const range = lastMonths(months);
    setDraft((current) => ({ ...current, ...range }));
    setPage(1);
    setFilters((current) => ({ ...current, ...range, page: 1 }));
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    setFilters((current) => ({ ...current, page: nextPage }));
  }

  const data = report.data?.report;
  const maxRevenue = Math.max(1, ...(data?.monthlyRevenue.map((row) => row.revenueIdr) ?? [0]));
  const maxRequests = Math.max(1, ...(data?.monthlyAiUsage.map((row) => row.requests) ?? [0]));

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Business intelligence"
        title="Laporan operasional"
        description="Filter periode dan fitur untuk melihat pendapatan, pemakaian AI, serta pembelian dan pemakaian kredit per pengguna."
      />

      <AdminPanel
        title="Filter laporan"
        description="Bulan mengikuti zona waktu Asia/Jakarta. Rentang maksimal 36 bulan."
      >
        <form onSubmit={applyFilters} className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap gap-2">
            {[3, 6, 12].map((months) => (
              <button
                key={months}
                type="button"
                onClick={() => chooseRange(months)}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium hover:border-amber-400"
              >
                {months} bulan terakhir
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Dari bulan
              </span>
              <input
                type="month"
                required
                value={draft.from}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, from: event.target.value }))
                }
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Sampai bulan
              </span>
              <input
                type="month"
                required
                value={draft.to}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, to: event.target.value }))
                }
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Fitur AI
              </span>
              <select
                value={draft.feature}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, feature: event.target.value }))
                }
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              >
                <option value="">Semua fitur</option>
                {FEATURE_KEYS.map((feature) => (
                  <option key={feature} value={feature}>
                    {DEFAULT_FEATURE_PRICING[feature].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Cari pengguna
              </span>
              <input
                type="search"
                placeholder="Nama atau email"
                value={draft.search}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, search: event.target.value }))
                }
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Urutkan pengguna
              </span>
              <select
                value={draft.sort}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sort: event.target.value as DraftFilters['sort'],
                  }))
                }
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              >
                <option value="usage">Pemakaian kredit</option>
                <option value="purchases">Pembelian kredit</option>
                <option value="balance">Saldo saat ini</option>
              </select>
            </label>
            <button
              type="submit"
              className="mt-auto rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white dark:bg-amber-500 dark:text-slate-950"
            >
              Terapkan filter
            </button>
          </div>
        </form>
      </AdminPanel>

      {report.isPending ? <p className="text-sm">Memuat laporan…</p> : null}
      {report.isError ? <AdminError error={report.error} /> : null}

      {data ? (
        <>
          <section
            aria-label="Ringkasan laporan"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <AdminMetric
              icon={CreditCard}
              label="Pendapatan"
              value={formatIdr(data.summary.revenueIdr)}
              hint={`${data.summary.payments} pembayaran lunas`}
              tone="emerald"
            />
            <AdminMetric
              icon={BrainCircuit}
              label="Biaya AI"
              value={`$${data.summary.aiEstimatedCostUsd.toFixed(2)}`}
              hint={`${formatNumber(data.summary.aiRequests)} permintaan model`}
              tone="blue"
            />
            <AdminMetric
              icon={Coins}
              label="Pembelian kredit"
              value={formatCredits(data.summary.creditsPurchased)}
              hint="Ledger TOP_UP pada periode terpilih"
              tone="violet"
            />
            <AdminMetric
              icon={UsersRound}
              label="Pemakaian kredit"
              value={formatCredits(data.summary.creditsUsed)}
              hint={`${data.perUser.total} pengguna dengan aktivitas kredit`}
              tone="amber"
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <AdminPanel
              title="Pendapatan per bulan"
              description={`${monthLabel(data.range.from)} – ${monthLabel(data.range.to)}`}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                    <tr>
                      <th className="px-5 py-3 font-medium">Bulan</th>
                      <th className="px-5 py-3 font-medium">Pendapatan</th>
                      <th className="px-5 py-3 font-medium">Transaksi</th>
                      <th className="px-5 py-3 font-medium">Kredit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {data.monthlyRevenue.map((row) => (
                      <tr key={row.month}>
                        <td className="px-5 py-3">
                          <span className="block font-medium">{monthLabel(row.month)}</span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                            <span
                              className="block h-full rounded-full bg-emerald-500"
                              style={{
                                width: `${Math.round((row.revenueIdr / maxRevenue) * 100)}%`,
                              }}
                            />
                          </span>
                        </td>
                        <td className="px-5 py-3 font-medium">{formatIdr(row.revenueIdr)}</td>
                        <td className="px-5 py-3 text-[var(--color-content-muted)]">
                          {formatNumber(row.payments)}
                        </td>
                        <td className="px-5 py-3 text-[var(--color-content-muted)]">
                          {formatNumber(row.creditsSold)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminPanel>

            <AdminPanel
              title="Pemakaian AI per bulan"
              description={
                filters.feature
                  ? `Fitur ${DEFAULT_FEATURE_PRICING[filters.feature as keyof typeof DEFAULT_FEATURE_PRICING]?.label ?? filters.feature}`
                  : 'Seluruh fitur AI'
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                    <tr>
                      <th className="px-5 py-3 font-medium">Bulan</th>
                      <th className="px-5 py-3 font-medium">Permintaan</th>
                      <th className="px-5 py-3 font-medium">Token</th>
                      <th className="px-5 py-3 font-medium">Biaya</th>
                      <th className="px-5 py-3 font-medium">Kredit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {data.monthlyAiUsage.map((row) => (
                      <tr key={row.month}>
                        <td className="px-5 py-3">
                          <span className="block font-medium">{monthLabel(row.month)}</span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                            <span
                              className="block h-full rounded-full bg-sky-500"
                              style={{
                                width: `${Math.round((row.requests / maxRequests) * 100)}%`,
                              }}
                            />
                          </span>
                        </td>
                        <td className="px-5 py-3 font-medium">
                          {formatNumber(row.requests)}
                          {row.failedRequests > 0 ? (
                            <span className="block text-xs font-normal text-red-600">
                              {formatNumber(row.failedRequests)} gagal
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                          {formatNumber(row.inputTokens + row.outputTokens)} total
                          <span className="block">{formatNumber(row.cachedTokens)} cached</span>
                        </td>
                        <td className="px-5 py-3">${row.estimatedCostUsd.toFixed(2)}</td>
                        <td className="px-5 py-3 text-[var(--color-content-muted)]">
                          {formatNumber(row.creditsCharged)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminPanel>
          </section>

          <AdminPanel
            title="Kredit per pengguna"
            description="Pembelian berasal dari ledger TOP_UP; pemakaian berasal dari transaksi USAGE."
          >
            {data.perUser.items.length === 0 ? (
              <AdminEmpty>Tidak ada aktivitas kredit yang cocok dengan filter.</AdminEmpty>
            ) : null}
            {data.perUser.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                    <tr>
                      <th className="px-5 py-3 font-medium">Pengguna</th>
                      <th className="px-5 py-3 font-medium">Peran</th>
                      <th className="px-5 py-3 font-medium">Pembelian</th>
                      <th className="px-5 py-3 font-medium">Pemakaian</th>
                      <th className="px-5 py-3 font-medium">Saldo saat ini</th>
                      <th className="px-5 py-3 font-medium">Ditahan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {data.perUser.items.map((row) => (
                      <tr key={row.userId}>
                        <td className="px-5 py-3">
                          <span className="block font-medium">{row.fullName ?? row.email}</span>
                          <span className="block text-xs text-[var(--color-content-muted)]">
                            {row.email}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-1 text-xs font-medium">
                            {row.role}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="block font-medium">
                            {formatNumber(row.creditsPurchased)}
                          </span>
                          <span className="block text-xs text-[var(--color-content-muted)]">
                            {row.purchaseCount} transaksi
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="block font-medium">{formatNumber(row.creditsUsed)}</span>
                          <span className="block text-xs text-[var(--color-content-muted)]">
                            {row.usageCount} transaksi
                          </span>
                        </td>
                        <td className="px-5 py-3 font-medium">{formatCredits(row.balance)}</td>
                        <td className="px-5 py-3 text-[var(--color-content-muted)]">
                          {formatNumber(row.reserved)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <AdminPagination
              page={data.perUser.page}
              pageSize={data.perUser.pageSize}
              total={data.perUser.total}
              onChange={changePage}
            />
          </AdminPanel>
        </>
      ) : null}

      {page !== filters.page ? <span className="sr-only">Memuat halaman {page}</span> : null}
    </div>
  );
}
