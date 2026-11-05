import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  FilePlus2,
  Files,
  Plus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import { formatDateTimeId } from '@aseb/shared';

import { useAuth } from '../lib/auth.js';
import { useScreeningJobsQuery } from '../lib/screening.js';
import { ScreeningStateBadge } from './ScreeningPage.js';

const ACTIVE_STATES = new Set([
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
  'PARTIALLY_COMPLETED',
]);

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-[var(--color-content-muted)] uppercase">
            {label}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-content-muted)]">{hint}</p>
    </article>
  );
}

export function HrdDashboardPage() {
  const { profile } = useAuth();
  const jobs = useScreeningJobsQuery();
  const items = jobs.data?.items ?? [];
  const activeJobs = items.filter((job) => ACTIVE_STATES.has(job.state)).length;
  const totalCandidates = items.reduce((total, job) => total + job.totalCandidates, 0);
  const completedCandidates = items.reduce((total, job) => total + job.completedCandidates, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-[1.5rem] border border-emerald-500/20 bg-[var(--color-surface-raised)] p-6 shadow-sm sm:p-8">
        <div className="absolute -top-24 -right-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700 uppercase dark:text-emerald-300">
              Recruitment workspace
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Halo, {profile?.fullName?.split(' ')[0] ?? 'Recruiter'}.
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--color-content-muted)] sm:text-base">
              Kelola batch kandidat, pantau proses, dan tinjau bukti per kriteria. Skor dan ranking
              tetap dihitung deterministik oleh sistem.
            </p>
          </div>
          <Link
            to="/screening"
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Buat sesi screening
          </Link>
        </div>
      </section>

      <section
        aria-label="Ringkasan screening"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Metric
          icon={BriefcaseBusiness}
          label="Total sesi"
          value={jobs.data ? String(jobs.data.total) : '—'}
          hint="Seluruh sesi pada akun ini"
        />
        <Metric
          icon={FilePlus2}
          label="Sesi aktif"
          value={jobs.data ? String(activeJobs) : '—'}
          hint="Draf, antrean, dan proses berjalan"
        />
        <Metric
          icon={UsersRound}
          label="Kandidat"
          value={jobs.data ? String(totalCandidates) : '—'}
          hint="Total kandidat dalam 20 sesi terbaru"
        />
        <Metric
          icon={CheckCircle2}
          label="Selesai dinilai"
          value={jobs.data ? String(completedCandidates) : '—'}
          hint="Memiliki hasil evidence dan skor"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">Sesi terbaru</h2>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                Buka sesi untuk upload CV, melihat hasil, atau mengunduh laporan.
              </p>
            </div>
            <Link
              to="/screening"
              className="text-sm font-medium text-emerald-700 dark:text-emerald-300"
            >
              Kelola semua
            </Link>
          </div>

          {jobs.isPending ? (
            <p className="px-5 py-8 text-sm text-[var(--color-content-muted)]">Memuat sesi…</p>
          ) : null}
          {jobs.isError ? (
            <p role="alert" className="px-5 py-8 text-sm text-[var(--color-danger)]">
              Sesi screening tidak dapat dimuat.
            </p>
          ) : null}
          {jobs.data && items.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Files aria-hidden className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-semibold">Belum ada sesi screening</h3>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                Buat kriteria lowongan dan unggah batch CV pertama.
              </p>
              <Link
                to="/screening"
                className="mt-4 inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Mulai screening
              </Link>
            </div>
          ) : null}
          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-medium">Posisi</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Kandidat</th>
                    <th className="px-5 py-3 font-medium">Dibuat</th>
                    <th className="px-5 py-3 text-right font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {items.slice(0, 6).map((job) => (
                    <tr key={job.id}>
                      <td className="px-5 py-4 font-medium">{job.title}</td>
                      <td className="px-5 py-4">
                        <ScreeningStateBadge state={job.state} />
                      </td>
                      <td className="px-5 py-4 text-[var(--color-content-muted)]">
                        {job.completedCandidates}/{job.totalCandidates} selesai
                      </td>
                      <td className="px-5 py-4 text-[var(--color-content-muted)]">
                        {formatDateTimeId(job.createdAt)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          to={`/screening/${job.id}`}
                          aria-label={`Detail ${job.title}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs font-medium hover:border-emerald-400"
                        >
                          Detail <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Alur HRD</h2>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Satu metode yang konsisten untuk setiap lowongan.
          </p>
          <ol className="mt-5 flex flex-col gap-4">
            {[
              ['01', 'Buat kriteria', 'Tentukan posisi, deskripsi, dan syarat wajib.'],
              ['02', 'Unggah batch', 'Maksimal 50 PDF atau satu ZIP per sesi.'],
              ['03', 'Tinjau evidence', 'Periksa kutipan dan status per kriteria.'],
              ['04', 'Ekspor laporan', 'Bagikan hasil CSV atau PDF yang dapat diaudit.'],
            ].map(([step, title, detail]) => (
              <li key={step} className="flex gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  {step}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-content-muted)]">
                    {detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <Link
            to="/screening"
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
          >
            Buka manajemen screening
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </article>
      </section>
    </div>
  );
}
