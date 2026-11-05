import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  Coins,
  CreditCard,
  Database,
  Settings2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { formatCredits, formatDateTimeId, formatIdr } from '@aseb/shared';

import {
  useAdminFailedCandidatesQuery,
  useAdminJobsQuery,
  useAdminOverviewQuery,
} from '../../lib/admin.js';
import { AdminEmpty, AdminError, AdminMetric, AdminPageHeader, AdminPanel } from './AdminUi.js';

const QUICK_LINKS = [
  {
    to: '/admin/reports',
    icon: BarChart3,
    title: 'Laporan bulanan',
    description: 'Pendapatan, pemakaian AI, dan kredit per pengguna.',
  },
  {
    to: '/admin/users',
    icon: UsersRound,
    title: 'Kelola pengguna',
    description: 'Cari akun, ubah peran, dan sesuaikan saldo lewat ledger.',
  },
  {
    to: '/admin/billing',
    icon: CreditCard,
    title: 'Keuangan',
    description: 'Pembayaran, transaksi kredit, dan delivery webhook.',
  },
  {
    to: '/admin/settings',
    icon: Settings2,
    title: 'Harga & moderasi',
    description: 'Atur harga fitur dan tinjau testimoni pengguna.',
  },
] as const;

export function AdminDashboardPage() {
  const overview = useAdminOverviewQuery();
  const failed = useAdminFailedCandidatesQuery();
  const jobs = useAdminJobsQuery();
  const data = overview.data?.overview;
  const margin =
    data && data.ai.estimatedCostUsdLast30Days > 0
      ? data.ai.targetRevenueUsdLast30Days / data.ai.estimatedCostUsdLast30Days
      : null;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Admin overview"
        title="Konsol admin"
        description="Ringkasan 30 hari terakhir dari ledger, pembayaran, catatan pemakaian AI, dan antrean screening."
        actions={
          <Link
            to="/admin/reports"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm dark:bg-amber-500 dark:text-slate-950"
          >
            Buka laporan
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        }
      />

      {overview.isPending ? <p className="text-sm">Memuat ringkasan…</p> : null}
      {overview.isError ? <AdminError error={overview.error} /> : null}

      {data ? (
        <>
          <section
            aria-label="Metrik platform"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <AdminMetric
              icon={UsersRound}
              label="Pengguna"
              value={formatNumberSafe(data.users.total)}
              hint={`+${data.users.newLast7Days} dalam 7 hari · ${data.users.admins} admin`}
              tone="amber"
            />
            <AdminMetric
              icon={Coins}
              label="Kredit beredar"
              value={formatCredits(data.credits.outstanding)}
              hint={`${formatCredits(data.credits.reserved)} ditahan reservasi`}
              tone="violet"
            />
            <AdminMetric
              icon={CreditCard}
              label="Pendapatan 30 hari"
              value={formatIdr(data.revenue.paidIdrLast30Days)}
              hint={`${data.revenue.paidTransactionsLast30Days} transaksi · ${formatIdr(data.revenue.pendingIdr)} menunggu`}
              tone="emerald"
            />
            <AdminMetric
              icon={BrainCircuit}
              label="Biaya AI 30 hari"
              value={`$${data.ai.estimatedCostUsdLast30Days.toFixed(2)}`}
              hint={
                margin === null
                  ? `${data.ai.requestsLast30Days} permintaan`
                  : `${data.ai.requestsLast30Days} permintaan · margin ${margin.toFixed(2)}x`
              }
              tone="blue"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <AdminPanel
              title="Akses cepat"
              description="Tugas operasional yang paling sering dibutuhkan."
            >
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {QUICK_LINKS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="group rounded-xl border border-[var(--color-border-subtle)] p-4 transition hover:border-amber-400 hover:bg-amber-500/[0.03]"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
                        <Icon aria-hidden className="h-4 w-4" />
                      </span>
                      <span className="mt-3 block text-sm font-semibold">{item.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--color-content-muted)]">
                        {item.description}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </AdminPanel>

            <AdminPanel title="Kesehatan sistem" description="Konfigurasi runtime aktif.">
              <dl className="divide-y divide-[var(--color-border-subtle)] px-5 py-2 text-sm">
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="flex items-center gap-2 text-[var(--color-content-muted)]">
                    <Database aria-hidden className="h-4 w-4" /> Database
                  </dt>
                  <dd className="font-medium">{data.system.database}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[var(--color-content-muted)]">Queue</dt>
                  <dd className="font-medium">{data.system.queueDriver}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[var(--color-content-muted)]">Redis</dt>
                  <dd className="font-medium">{data.system.redis}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[var(--color-content-muted)]">AI provider</dt>
                  <dd className="font-medium">{data.system.aiProvider}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-[var(--color-content-muted)]">Payment provider</dt>
                  <dd className="font-medium">{data.system.paymentProvider}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="flex items-center gap-2 text-[var(--color-content-muted)]">
                    <ShieldCheck aria-hidden className="h-4 w-4" /> Environment
                  </dt>
                  <dd className="font-medium">{data.system.environment}</dd>
                </div>
              </dl>
            </AdminPanel>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdminMetric
              icon={BriefcaseBusiness}
              label="Screening"
              value={`${data.screening.totalJobs} sesi`}
              hint={`${data.screening.activeJobs} aktif · ${data.screening.totalCandidates} kandidat`}
              tone="emerald"
            />
            <AdminMetric
              icon={BarChart3}
              label="Kandidat gagal"
              value={formatNumberSafe(data.screening.failedCandidates)}
              hint={`${(data.screening.failureRate * 100).toFixed(0)}% dari seluruh kandidat`}
              tone="amber"
            />
            <AdminMetric
              icon={Coins}
              label="Kredit terpakai"
              value={formatCredits(data.credits.creditsSpentLast30Days)}
              hint={`${formatCredits(data.credits.creditsInLast30Days)} masuk dalam 30 hari`}
              tone="violet"
            />
            <AdminMetric
              icon={ShieldCheck}
              label="Moderasi"
              value={`${data.testimonials.pending} menunggu`}
              hint={`${data.testimonials.approved} tayang · ${data.testimonials.rejected} ditolak`}
              tone="blue"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <AdminPanel
              title="Kandidat gagal"
              description="Kasus terbaru yang perlu ditinjau."
              actions={
                <Link
                  to="/admin/screening"
                  className="text-sm font-medium text-amber-700 dark:text-amber-300"
                >
                  Lihat semua
                </Link>
              }
            >
              {failed.isError ? (
                <div className="p-4">
                  <AdminError error={failed.error} />
                </div>
              ) : null}
              {failed.data && failed.data.failed.items.length === 0 ? (
                <AdminEmpty>Tidak ada kandidat gagal.</AdminEmpty>
              ) : null}
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {failed.data?.failed.items.slice(0, 5).map((item) => (
                  <li key={item.id} className="px-5 py-3 text-sm">
                    <span className="font-medium">{item.candidateName}</span>
                    <span className="text-[var(--color-content-muted)]"> · {item.jobTitle}</span>
                    <p className="mt-1 text-xs text-red-600">
                      {item.failureReason ?? `${item.attempts} percobaan`}
                    </p>
                  </li>
                ))}
              </ul>
            </AdminPanel>

            <AdminPanel
              title="Sesi screening terbaru"
              description="Aktivitas pekerjaan dari seluruh akun."
              actions={
                <Link
                  to="/admin/screening"
                  className="text-sm font-medium text-amber-700 dark:text-amber-300"
                >
                  Lihat semua
                </Link>
              }
            >
              {jobs.data?.jobs.items.length === 0 ? (
                <AdminEmpty>Belum ada sesi screening.</AdminEmpty>
              ) : null}
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {jobs.data?.jobs.items.slice(0, 6).map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <span>
                      <span className="block font-medium">{job.title}</span>
                      <span className="block text-xs text-[var(--color-content-muted)]">
                        {job.ownerEmail} · {job.totalCandidates} kandidat
                      </span>
                    </span>
                    <span className="text-xs text-[var(--color-content-muted)]">
                      {job.state} · {formatDateTimeId(job.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </AdminPanel>
          </section>
        </>
      ) : null}
    </div>
  );
}

function formatNumberSafe(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value);
}
