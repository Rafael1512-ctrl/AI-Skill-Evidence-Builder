import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { formatDateTimeId, type ScreeningJobState } from '@aseb/shared';

import { useAuth } from '../lib/auth.js';
import { useCreateScreeningJobMutation, useScreeningJobsQuery } from '../lib/screening.js';

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Screening kandidat</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Setiap kandidat dinilai dengan bukti per kriteria. Skor dihitung mesin deterministik,
          bukan oleh model bahasa.
        </p>
      </header>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
        <h2 className="text-lg font-medium">Buat sesi screening</h2>
        <form className="mt-4 flex flex-col gap-4" onSubmit={submit} noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Posisi</span>
            <input
              className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Backend Engineer"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Deskripsi pekerjaan</span>
            <textarea
              className="min-h-24 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Tanggung jawab, teknologi, dan konteks tim."
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Kriteria (satu per baris)</span>
            <textarea
              className="min-h-24 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
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
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={createJob.isPending}
            className="self-start rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {createJob.isPending ? 'Membuat…' : 'Buat sesi'}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Sesi saya</h2>

        {jobs.isPending ? <p className="text-sm">Memuat…</p> : null}
        {jobs.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {(jobs.error as Error).message}
          </p>
        ) : null}
        {jobs.data && jobs.data.items.length === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            Belum ada sesi screening. Buat satu untuk mulai mengunggah CV.
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {jobs.data?.items.map((job) => (
            <li key={job.id}>
              <Link
                to={`/screening/${job.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-3 hover:border-[var(--color-brand)]"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{job.title}</span>
                  <span className="text-xs text-[var(--color-content-muted)]">
                    {job.totalCandidates} kandidat · {job.completedCandidates} selesai ·{' '}
                    {job.failedCandidates} gagal · dibuat {formatDateTimeId(job.createdAt)}
                  </span>
                </span>
                <ScreeningStateBadge state={job.state} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
