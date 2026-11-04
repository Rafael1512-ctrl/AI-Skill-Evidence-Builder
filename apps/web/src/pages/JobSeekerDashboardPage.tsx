import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Coins,
  FileSearch,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';

import { formatCredits, formatDateTimeId } from '@aseb/shared';

import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useAuth } from '../lib/auth.js';
import { useWalletQuery } from '../lib/credits.js';
import { useAuditUsageQuery } from '../lib/cvAudit.js';
import { useCvHistoryQuery, useDeleteCvDocumentMutation } from '../lib/cvHistory.js';

const ENHANCEMENT_LABELS = {
  PENDING: 'Menunggu',
  PROCESSING: 'Diproses',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  REFUNDED: 'Dikembalikan',
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
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
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-content-muted)]">{hint}</p>
    </article>
  );
}

function QuickAction({
  to,
  icon: Icon,
  eyebrow,
  title,
  description,
  primary = false,
}: {
  to: string;
  icon: typeof Coins;
  eyebrow: string;
  title: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group rounded-2xl border p-5 transition hover:-translate-y-0.5 ${
        primary
          ? 'border-violet-600 bg-violet-600 text-white shadow-lg shadow-violet-600/15'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] hover:border-violet-400'
      }`}
    >
      <span
        className={`grid h-10 w-10 place-items-center rounded-xl ${
          primary ? 'bg-white/15' : 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
        }`}
      >
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <p
        className={`mt-4 text-xs font-semibold tracking-wide uppercase ${primary ? 'text-white/75' : 'text-[var(--color-content-muted)]'}`}
      >
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      <p
        className={`mt-1 text-sm ${primary ? 'text-white/80' : 'text-[var(--color-content-muted)]'}`}
      >
        {description}
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium">
        Mulai <ArrowRight aria-hidden className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export function JobSeekerDashboardPage() {
  const { profile } = useAuth();
  const wallet = useWalletQuery();
  const usage = useAuditUsageQuery();
  const history = useCvHistoryQuery();
  const removeDocument = useDeleteCvDocumentMutation();
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);

  const activities = [
    ...(history.data?.analyses.map((analysis) => ({
      id: `analysis-${analysis.id}`,
      title: analysis.kind === 'FREE_AUDIT' ? 'Audit CV gratis' : 'Audit CV tambahan',
      detail: `Skor ATS ${analysis.atsScore}/100 · ${analysis.provider}`,
      createdAt: analysis.createdAt,
      kind: 'analysis' as const,
      documentId: analysis.documentId,
      state: 'Selesai',
    })) ?? []),
    ...(history.data?.enhancements.map((enhancement) => ({
      id: `enhancement-${enhancement.id}`,
      title: 'Peningkatan CV',
      detail: `${enhancement.templateKey} · ${enhancement.creditsCharged} kredit`,
      createdAt: enhancement.createdAt,
      kind: 'enhancement' as const,
      documentId: enhancement.sourceDocumentId,
      state: ENHANCEMENT_LABELS[enhancement.status],
    })) ?? []),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-[1.5rem] border border-violet-500/20 bg-[var(--color-surface-raised)] p-6 shadow-sm sm:p-8">
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.18em] text-violet-600 uppercase dark:text-violet-300">
              Career workspace
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Selamat datang, {profile?.fullName?.split(' ')[0] ?? 'Job Seeker'}.
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--color-content-muted)] sm:text-base">
              Kelola audit dan peningkatan CV dari satu tempat. Semua rekomendasi tetap berbasis
              bukti dan tidak menambahkan pengalaman atau angka yang tidak ada.
            </p>
          </div>
          <Link
            to="/audit"
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/20"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Audit CV baru
          </Link>
        </div>
      </section>

      <section aria-label="Ringkasan akun" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileSearch}
          label="Audit gratis tersisa"
          value={
            usage.data ? `${usage.data.freeAuditsRemaining}/${usage.data.freeAuditsLimit}` : '—'
          }
          hint={
            usage.data
              ? `Reset ${formatDateTimeId(usage.data.resetsAt)}`
              : 'Memuat kuota audit harian'
          }
        />
        <StatCard
          icon={Coins}
          label="Kredit tersedia"
          value={wallet.data ? formatCredits(wallet.data.available) : '—'}
          hint="Satu dompet untuk Job Seeker dan HRD"
        />
        <StatCard
          icon={FileText}
          label="Audit tersimpan"
          value={history.data ? String(history.data.totals.analyses) : '—'}
          hint="Termasuk audit gratis dan tambahan"
        />
        <StatCard
          icon={Sparkles}
          label="CV disempurnakan"
          value={history.data ? String(history.data.totals.enhancements) : '—'}
          hint="Riwayat hasil dan ekspor PDF"
        />
      </section>

      <section aria-labelledby="job-seeker-actions" className="flex flex-col gap-3">
        <div>
          <h2 id="job-seeker-actions" className="text-xl font-semibold tracking-tight">
            Mulai dari sini
          </h2>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Alur utama pencari kerja dalam tiga aksi.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <QuickAction
            to="/audit"
            icon={FileSearch}
            eyebrow="Create / Audit"
            title="Audit CV"
            description="Dapatkan temuan ATS, kekuatan, celah, dan saran yang bisa ditindaklanjuti."
            primary
          />
          <QuickAction
            to="/enhance"
            icon={Sparkles}
            eyebrow="Create / Enhance"
            title="Sempurnakan CV"
            description="Perbaiki struktur dan bahasa tanpa menciptakan fakta baru."
          />
          <QuickAction
            to="/profile"
            icon={UserRound}
            eyebrow="Update / Profile"
            title="Kelola profil"
            description="Perbarui headline, kontak, dan tautan portofolio untuk pengalaman yang konsisten."
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Aktivitas CV terbaru</h2>
            <p className="mt-1 text-sm text-[var(--color-content-muted)]">
              Baca riwayat dan hapus data CV yang sudah tidak diperlukan.
            </p>
          </div>
          <Link to="/audit" className="text-sm font-medium text-violet-600 dark:text-violet-300">
            Tambah aktivitas
          </Link>
        </div>

        {history.isPending ? (
          <p className="px-5 py-8 text-sm text-[var(--color-content-muted)]">Memuat aktivitas…</p>
        ) : null}
        {history.isError ? (
          <p role="alert" className="px-5 py-8 text-sm text-[var(--color-danger)]">
            Riwayat CV tidak dapat dimuat.
          </p>
        ) : null}
        {history.data && activities.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <FileSearch aria-hidden className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-semibold">Belum ada aktivitas CV</h3>
            <p className="mt-1 text-sm text-[var(--color-content-muted)]">
              Mulai dengan audit gratis pertama Anda.
            </p>
            <Link
              to="/audit"
              className="mt-4 inline-flex rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Audit CV sekarang
            </Link>
          </div>
        ) : null}

        {activities.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Aktivitas</th>
                  <th className="px-5 py-3 font-medium">Detail</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Tanggal</th>
                  <th className="px-5 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {activities.map((activity) => (
                  <tr key={activity.id}>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2 font-medium">
                        {activity.kind === 'analysis' ? (
                          <FileSearch aria-hidden className="h-4 w-4 text-violet-600" />
                        ) : (
                          <Sparkles aria-hidden className="h-4 w-4 text-violet-600" />
                        )}
                        {activity.title}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[var(--color-content-muted)]">
                      {activity.detail}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                        {activity.state}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[var(--color-content-muted)]">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 aria-hidden className="h-3.5 w-3.5" />
                        {formatDateTimeId(activity.createdAt)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {activity.documentId ? (
                        <button
                          type="button"
                          aria-label={`Hapus ${activity.title}`}
                          onClick={() => setDocumentToDelete(activity.documentId)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:border-[var(--color-danger)]"
                        >
                          <Trash2 aria-hidden className="h-3.5 w-3.5" />
                          Hapus
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--color-content-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={documentToDelete !== null}
        title="Hapus data CV?"
        confirmLabel="Hapus permanen"
        busy={removeDocument.isPending}
        onCancel={() => setDocumentToDelete(null)}
        onConfirm={() => {
          if (!documentToDelete) return;
          removeDocument.mutate(documentToDelete, {
            onSuccess: () => setDocumentToDelete(null),
          });
        }}
      >
        <p>
          File dan teks CV ini akan dihapus dari data aktif. Riwayat analisis tetap tersimpan tanpa
          teks sumbernya.
        </p>
        {removeDocument.isError ? (
          <p role="alert" className="text-[var(--color-danger)]">
            {removeDocument.error.message}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
