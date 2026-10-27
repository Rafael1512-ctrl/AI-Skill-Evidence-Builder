import { useState } from 'react';
import { Link } from 'react-router-dom';

import { formatCredits, formatDateTimeId, formatIdr } from '@aseb/shared';

import { useAuth } from '../lib/auth.js';
import {
  useAdminFailedCandidatesQuery,
  useAdminJobsQuery,
  useAdminOverviewQuery,
  useAdminTestimonialsQuery,
  useModerateTestimonialMutation,
  useUpdateFeaturePricingMutation,
} from '../lib/admin.js';
import { RatingStars } from './TestimonialsPage.js';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4">
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-content-muted)]">{hint}</p> : null}
    </div>
  );
}

function PricingEditor() {
  const overview = useAdminOverviewQuery();
  const update = useUpdateFeaturePricingMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Harga kredit</h2>
      <p className="text-xs text-[var(--color-content-muted)]">
        Perubahan disimpan sebagai override di tabel harga dan langsung dipakai layanan kredit.
        Angka default tetap berasal dari paket bersama.
      </p>
      {notice ? <p className="text-sm text-[var(--color-content-muted)]">{notice}</p> : null}
      <ul className="flex flex-col gap-2">
        {overview.data?.pricing.map((item) => (
          <li
            key={item.feature}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-3"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-xs text-[var(--color-content-muted)]">
                {item.feature}
                {item.isOverride
                  ? ` · override (diubah ${item.updatedAt ? formatDateTimeId(item.updatedAt) : '-'})`
                  : ' · default'}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <input
                aria-label={`Kredit ${item.feature}`}
                className="w-20 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-sm"
                value={drafts[item.feature] ?? String(item.credits)}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [item.feature]: event.target.value }))
                }
              />
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                disabled={update.isPending}
                onClick={() => {
                  const credits = Number(drafts[item.feature] ?? item.credits);
                  setNotice(null);
                  update.mutate(
                    { feature: item.feature, credits },
                    {
                      onSuccess: (updated) =>
                        setNotice(`${updated.label} sekarang ${updated.credits} kredit.`),
                      onError: (error) => setNotice(error.message),
                    },
                  );
                }}
              >
                Simpan
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ModerationQueue() {
  const queue = useAdminTestimonialsQuery('PENDING');
  const moderate = useModerateTestimonialMutation();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Moderasi testimoni</h2>
      {queue.isPending ? <p className="text-sm">Memuat…</p> : null}
      {queue.data && queue.data.testimonials.items.length === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">Tidak ada testimoni menunggu.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {queue.data?.testimonials.items.map((testimonial) => (
          <li
            key={testimonial.id}
            className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{testimonial.displayName}</span>
              <RatingStars rating={testimonial.rating} />
            </div>
            <p className="mt-2 text-sm">{testimonial.comment}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                disabled={moderate.isPending}
                onClick={() => moderate.mutate({ id: testimonial.id, status: 'APPROVED' })}
              >
                Setujui
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                disabled={moderate.isPending}
                onClick={() => moderate.mutate({ id: testimonial.id, status: 'REJECTED' })}
              >
                Tolak
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminPage() {
  const { profile, status } = useAuth();
  const overview = useAdminOverviewQuery();
  const failed = useAdminFailedCandidatesQuery();
  const jobs = useAdminJobsQuery();

  if (status !== 'signed-in' || profile?.role !== 'ADMIN') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Konsol admin</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Halaman ini hanya untuk admin. Akses tetap diverifikasi di server.
        </p>
        <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
          Kembali ke beranda
        </Link>
      </main>
    );
  }

  const data = overview.data?.overview;
  const margin =
    data && data.ai.estimatedCostUsdLast30Days > 0
      ? data.ai.targetRevenueUsdLast30Days / data.ai.estimatedCostUsdLast30Days
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Konsol admin</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Ringkasan 30 hari terakhir. Semua angka dibaca dari ledger, pembayaran, dan catatan
          pemakaian AI.
        </p>
      </header>

      {overview.isPending ? <p className="text-sm">Memuat…</p> : null}
      {overview.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {(overview.error as Error).message}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Pengguna"
              value={String(data.users.total)}
              hint={`+${data.users.newLast7Days} dalam 7 hari · ${data.users.admins} admin`}
            />
            <Stat
              label="Kredit beredar"
              value={formatCredits(data.credits.outstanding)}
              hint={`${data.credits.reserved} ditahan`}
            />
            <Stat
              label="Pendapatan (30 hari)"
              value={formatIdr(data.revenue.paidIdrLast30Days)}
              hint={`${data.revenue.paidTransactionsLast30Days} transaksi · ${formatIdr(data.revenue.pendingIdr)} menunggu`}
            />
            <Stat
              label="Biaya AI (30 hari)"
              value={`$${data.ai.estimatedCostUsdLast30Days.toFixed(2)}`}
              hint={
                margin === null
                  ? `${data.ai.requestsLast30Days} permintaan`
                  : `${data.ai.requestsLast30Days} permintaan · margin ${margin.toFixed(2)}x`
              }
            />
            <Stat
              label="Screening"
              value={`${data.screening.totalJobs} sesi`}
              hint={`${data.screening.activeJobs} aktif · ${data.screening.failedCandidates}/${data.screening.totalCandidates} kandidat gagal`}
            />
            <Stat
              label="Testimoni"
              value={`${data.testimonials.pending} menunggu`}
              hint={`${data.testimonials.approved} tayang · ${data.testimonials.rejected} ditolak`}
            />
            <Stat
              label="Kredit terpakai (30 hari)"
              value={formatCredits(data.credits.creditsSpentLast30Days)}
              hint={`${formatCredits(data.credits.creditsInLast30Days)} masuk`}
            />
            <Stat
              label="Sistem"
              value={`DB ${data.system.database}`}
              hint={`queue ${data.system.queueDriver} · redis ${data.system.redis} · AI ${data.system.aiProvider} · bayar ${data.system.paymentProvider}`}
            />
          </section>

          <PricingEditor />
          <ModerationQueue />

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Kandidat gagal</h2>
            {failed.data && failed.data.failed.items.length === 0 ? (
              <p className="text-sm text-[var(--color-content-muted)]">Tidak ada kandidat gagal.</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {failed.data?.failed.items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm"
                >
                  <span className="font-medium">{item.candidateName}</span> · {item.jobTitle} ·{' '}
                  {item.attempts} percobaan
                  {item.failureReason ? (
                    <p className="mt-1 text-xs text-red-600">{item.failureReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Sesi screening terbaru</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {jobs.data?.jobs.items.slice(0, 10).map((job) => (
                <li key={job.id} className="text-[var(--color-content-muted)]">
                  {job.title} · {job.ownerEmail} · {job.state} · {job.totalCandidates} kandidat ·{' '}
                  {formatDateTimeId(job.createdAt)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--color-content-muted)]">
              Daftar pengguna, transaksi, pembayaran, webhook, dan pemakaian AI tersedia lewat API
              admin (`/api/admin/*`) dan akan ditampilkan di sini pada iterasi berikutnya.
            </p>
          </section>
        </>
      ) : null}

      <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke beranda
      </Link>
    </main>
  );
}
