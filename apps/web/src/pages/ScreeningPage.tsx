import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BriefcaseBusiness, FileCheck2, Plus, UsersRound } from 'lucide-react';

import { formatDateTimeId, type ScreeningJobState } from '@aseb/shared';

import { useAuth } from '../lib/auth.js';
import {
  useCancelScreeningJobMutation,
  useCreateScreeningJobMutation,
  useScreeningJobsQuery,
  type ScreeningJobSummary,
} from '../lib/screening.js';

const STATE_LABELS: Record<ScreeningJobState, string> = {
  CREATED: 'Draf',
  VALIDATING: 'Memvalidasi',
  QUEUED: 'Dalam antrean',
  PROCESSING: 'Diproses',
  PARTIALLY_COMPLETED: 'Selesai sebagian',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan',
};

export function ScreeningStateBadge({ state }: { state: ScreeningJobState }) {
  return (
    <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs font-medium">
      {STATE_LABELS[state]}
    </span>
  );
}

const ACTIVE_STATES: readonly ScreeningJobState[] = [
  'CREATED',
  'VALIDATING',
  'QUEUED',
  'PROCESSING',
];

function JobRow({ job }: { job: ScreeningJobSummary }) {
  const cancel = useCancelScreeningJobMutation(job.id);
  const canCancel = !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state);

  return (
    <li className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/screening/${job.id}`}
            className="truncate font-medium hover:text-emerald-700 dark:hover:text-emerald-300"
          >
            {job.title}
          </Link>
          <ScreeningStateBadge state={job.state} />
        </div>
        <p className="mt-1 text-xs text-[var(--color-content-muted)]">
          {job.totalCandidates} kandidat · {job.completedCandidates} selesai ·{' '}
          {job.failedCandidates} gagal · dibuat {formatDateTimeId(job.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canCancel ? (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] disabled:opacity-60"
          >
            {cancel.isPending ? 'Membatalkan…' : 'Batalkan'}
          </button>
        ) : null}
        <Link
          to={`/screening/${job.id}`}
          className="rounded-lg bg-[var(--color-content)] px-3 py-1.5 text-xs font-semibold text-[var(--color-surface)]"
        >
          Buka sesi
        </Link>
      </div>
    </li>
  );
}

/**
 * Recruiter workspace: screening jobs plus the form that creates one.
 *
 * The draft form sends criteria as free text lines - the API applies the documented defaults
 * (REQUIRED, weight 10, category OTHER) and the recruiter can refine them later without
 * losing the frozen version the job already recorded.
 */
export function ScreeningPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const jobs = useScreeningJobsQuery();
  const createJob = useCreateScreeningJobMutation();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [usePreferences, setUsePreferences] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  if (status !== 'signed-in') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Masuk untuk mulai screening</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Sesi screening tersimpan di akun Anda bersama dompet kredit yang sama.
        </p>
        <Link to="/signin" className="text-sm font-medium text-[var(--color-brand)]">
          Masuk atau daftar
        </Link>
      </main>
    );
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    setFormError(null);

    const requirements = criteriaText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => ({ text }));

    if (title.trim().length < 3) {
      setFormError('Judul minimal 3 karakter.');
      return;
    }
    if (description.trim().length < 20) {
      setFormError('Deskripsi pekerjaan minimal 20 karakter.');
      return;
    }
    if (requirements.length === 0) {
      setFormError('Tambahkan minimal satu kriteria, satu kriteria per baris.');
      return;
    }

    createJob.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        requirements,
        useRecruiterPreferences: usePreferences,
      },
      {
        onSuccess: (job) => void navigate(`/screening/${job.id}`),
        onError: (error) => setFormError(error.message),
      },
    );
  }

  const items = jobs.data?.items ?? [];
  const activeJobs = items.filter((job) => ACTIVE_STATES.includes(job.state)).length;
  const totalCandidates = items.reduce((total, job) => total + job.totalCandidates, 0);
  const completedCandidates = items.reduce((total, job) => total + job.completedCandidates, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700 uppercase dark:text-emerald-300">
            Manajemen screening
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Screening kandidat</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-content-muted)]">
            Setiap kandidat dinilai dengan bukti per kriteria. Skor dihitung mesin deterministik,
            bukan oleh model bahasa.
          </p>
        </div>
        <Link
          to="/dashboard/hrd"
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium"
        >
          <BriefcaseBusiness aria-hidden className="h-4 w-4" />
          Ringkasan HRD
        </Link>
      </header>

      <section aria-label="Ringkasan sesi" className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: BriefcaseBusiness,
            label: 'Sesi aktif',
            value: String(activeJobs),
          },
          {
            icon: UsersRound,
            label: 'Total kandidat',
            value: String(totalCandidates),
          },
          {
            icon: FileCheck2,
            label: 'Kandidat selesai',
            value: String(completedCandidates),
          },
        ].map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Icon aria-hidden className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-xs text-[var(--color-content-muted)]">{label}</span>
              <strong className="text-xl">{value}</strong>
            </span>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-4 py-4">
            <div>
              <h2 className="text-lg font-semibold">Sesi saya</h2>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                Pantau progres dan buka detail bukti kandidat.
              </p>
            </div>
            <span className="rounded-full bg-[var(--color-surface-muted)] px-2.5 py-1 text-xs font-medium">
              {jobs.data?.total ?? 0} sesi
            </span>
          </div>

          {jobs.isPending ? (
            <p className="px-4 py-8 text-sm text-[var(--color-content-muted)]">Memuat…</p>
          ) : null}
          {jobs.isError ? (
            <p role="alert" className="px-4 py-8 text-sm text-[var(--color-danger)]">
              {(jobs.error as Error).message}
            </p>
          ) : null}
          {jobs.data && items.length === 0 ? (
            <p className="px-4 py-10 text-sm text-[var(--color-content-muted)]">
              Belum ada sesi screening. Buat satu untuk mulai mengunggah CV.
            </p>
          ) : null}

          {items.length > 0 ? (
            <ul>
              {items.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-sm xl:sticky xl:top-20">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Plus aria-hidden className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Buat sesi screening</h2>
              <p className="text-xs text-[var(--color-content-muted)]">Create / lowongan baru</p>
            </div>
          </div>

          <form className="mt-5 flex flex-col gap-4" onSubmit={submit} noValidate>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Posisi</span>
              <input
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-emerald-500"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Backend Engineer"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Deskripsi pekerjaan</span>
              <textarea
                className="min-h-24 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-emerald-500"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Tanggung jawab, teknologi, dan konteks tim."
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Kriteria (satu per baris)</span>
              <textarea
                className="min-h-24 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2.5 outline-none focus:border-emerald-500"
                value={criteriaText}
                onChange={(event) => setCriteriaText(event.target.value)}
                placeholder={'Pengalaman minimal 3 tahun dengan Node.js\nPernah memimpin tim kecil'}
              />
              <span className="text-xs text-[var(--color-content-muted)]">
                Default: kriteria WAJIB dengan bobot 10. Preferensi perekrut yang tersimpan akan
                dipakai bila dicentang.
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={usePreferences}
                onChange={(event) => setUsePreferences(event.target.checked)}
              />
              <span>Gunakan preferensi perekrut saya</span>
            </label>

            {formError ? (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={createJob.isPending}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {createJob.isPending ? 'Membuat…' : 'Buat sesi'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
