import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  CircleCheckBig,
  Coins,
  FileSearch,
  Fingerprint,
  Scale,
  Sparkles,
  UserRoundSearch,
} from 'lucide-react';

import { useAuth } from '../lib/auth.js';

interface RoleCardProps {
  role: 'job-seeker' | 'hrd';
  signedIn: boolean;
  icon: typeof FileSearch;
  eyebrow: string;
  title: string;
  description: string;
  features: readonly string[];
}

function RoleCard({
  role,
  signedIn,
  icon: Icon,
  eyebrow,
  title,
  description,
  features,
}: RoleCardProps) {
  const destination = signedIn
    ? `/dashboard/${role}`
    : `/signin?next=${encodeURIComponent(`/dashboard/${role}`)}`;
  const accent =
    role === 'job-seeker'
      ? {
          card: 'hover:border-violet-400',
          icon: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
          button: 'bg-violet-600 text-white',
          text: 'text-violet-700 dark:text-violet-300',
        }
      : {
          card: 'hover:border-emerald-400',
          icon: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
          button: 'bg-emerald-600 text-white',
          text: 'text-emerald-700 dark:text-emerald-300',
        };

  return (
    <article
      className={`group flex flex-col rounded-[1.5rem] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-6 shadow-sm transition hover:-translate-y-0.5 ${accent.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-12 w-12 place-items-center rounded-2xl ${accent.icon}`}>
          <Icon aria-hidden className="h-6 w-6" />
        </span>
        <span className={`text-xs font-semibold tracking-wide uppercase ${accent.text}`}>
          {eyebrow}
        </span>
      </div>
      <h3 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 min-h-12 text-sm leading-6 text-[var(--color-content-muted)]">
        {description}
      </p>
      <ul className="mt-5 flex flex-1 flex-col gap-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <Check aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${accent.text}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        to={destination}
        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${accent.button}`}
      >
        {signedIn ? `Masuk ${title}` : `Pilih ${title}`}
        <ArrowRight aria-hidden className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </Link>
    </article>
  );
}

function WorkspacePreview() {
  return (
    <div
      role="img"
      aria-label="Pratinjau dashboard dengan ringkasan CV, bukti kandidat, dan dompet kredit"
      className="relative mx-auto w-full max-w-xl"
    >
      <div className="absolute -inset-8 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/20 bg-[#121426] p-3 shadow-2xl shadow-violet-950/30">
        <div className="flex items-center gap-1.5 px-2 pb-3 pt-1">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 h-6 flex-1 rounded-lg bg-white/5" />
        </div>
        <div className="grid min-h-[360px] grid-cols-[72px_1fr] overflow-hidden rounded-2xl bg-[#f8f8fc]">
          <div className="flex flex-col items-center gap-3 bg-[#1b1d34] px-3 py-5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500 text-xs font-bold text-white">
              AS
            </span>
            {[FileSearch, BriefcaseBusiness, Coins, UserRoundSearch].map((Icon, index) => (
              <span
                key={index}
                className={`grid h-9 w-9 place-items-center rounded-xl ${
                  index === 0 ? 'bg-white/15 text-white' : 'text-slate-400'
                }`}
              >
                <Icon aria-hidden className="h-4 w-4" />
              </span>
            ))}
          </div>
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-[10px] font-semibold tracking-wider text-violet-600 uppercase">
                  Career workspace
                </span>
                <span className="mt-1 block text-base font-semibold text-slate-900">
                  Ringkasan karier
                </span>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                Evidence ready
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ['Audit gratis', '5/5'],
                ['Kredit', '48'],
                ['Evidence', '12'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
                  <span className="block text-[9px] text-slate-500">{label}</span>
                  <span className="mt-1 block text-lg font-bold text-slate-900">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-700">Aktivitas CV</span>
                  <span className="text-[9px] text-violet-600">Lihat semua</span>
                </div>
                {[
                  ['Audit CV', 'ATS 82', 'bg-violet-100 text-violet-700'],
                  ['Peningkatan CV', 'Selesai', 'bg-emerald-100 text-emerald-700'],
                  ['Audit tambahan', '2 kredit', 'bg-amber-100 text-amber-700'],
                ].map(([title, status, style]) => (
                  <div
                    key={title}
                    className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2"
                  >
                    <span className="text-[9px] font-medium text-slate-700">{title}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${style}`}
                    >
                      {status}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <span className="text-[10px] font-semibold text-slate-700">Evidence score</span>
                <div className="mt-4 flex h-20 items-end gap-2">
                  {[45, 68, 54, 86, 72].map((height, index) => (
                    <span
                      key={index}
                      className={`flex-1 rounded-t-md ${index === 3 ? 'bg-emerald-500' : 'bg-emerald-200'}`}
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <span className="mt-2 block text-[9px] text-slate-500">
                  Deterministic, bukan AI ranking
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-2 hidden rounded-2xl border border-white/40 bg-white p-3 shadow-xl sm:block">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
            <BadgeCheck aria-hidden className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-[10px] text-slate-500">Evidence terverifikasi</span>
            <span className="block text-xs font-bold text-slate-900">Kutipan sumber terlihat</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const { profile, status } = useAuth();
  const signedIn = status === 'signed-in';

  return (
    <div className="min-h-dvh overflow-hidden bg-[var(--color-surface)]">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-content)] text-sm font-bold text-[var(--color-surface)]">
            AS
          </span>
          <span className="hidden sm:block">
            <span className="block text-sm font-semibold">AI Skill Evidence</span>
            <span className="block text-xs text-[var(--color-content-muted)]">Builder</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            to="/testimonials"
            className="hidden rounded-xl px-3 py-2 text-[var(--color-content-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-content)] sm:inline-flex"
          >
            Testimoni
          </Link>
          <Link
            to={signedIn ? '/credits' : '/signin'}
            className="rounded-xl border border-[var(--color-border-subtle)] px-3 py-2 font-medium"
          >
            {signedIn ? 'Kredit' : 'Masuk'}
          </Link>
          {signedIn ? (
            <Link
              to="/dashboard/job-seeker"
              className="rounded-xl bg-[var(--color-content)] px-3 py-2 font-semibold text-[var(--color-surface)]"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              to="/signin?tab=sign-up"
              className="rounded-xl bg-violet-600 px-3 py-2 font-semibold text-white"
            >
              Daftar
            </Link>
          )}
        </nav>
      </header>

      <main>
        <section className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1fr_0.95fr] lg:pt-16">
          <div className="relative z-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
              <Fingerprint aria-hidden className="h-4 w-4" />
              Evidence before assumption
            </span>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
              Bangun karier dengan CV yang diperkuat AI.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[var(--color-content-muted)] sm:text-lg">
              AI Skill Evidence Builder membantu pencari kerja menyempurnakan CV dan membantu HRD
              menyaring kandidat dengan bukti. Satu akun, satu dompet kredit, dua workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#pilih-workspace"
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20"
              >
                Pilih workspace
                <ArrowRight aria-hidden className="h-4 w-4" />
              </a>
              <Link
                to={signedIn ? (profile ? '/credits' : '/signin') : '/signin'}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-5 py-3 text-sm font-semibold"
              >
                <Sparkles aria-hidden className="h-4 w-4 text-violet-600" />
                {signedIn ? 'Kelola kredit' : 'Masuk ke akun'}
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-[var(--color-content-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <CircleCheckBig aria-hidden className="h-4 w-4 text-emerald-600" />5 audit
                gratis/hari
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CircleCheckBig aria-hidden className="h-4 w-4 text-emerald-600" />
                Tanpa fabrikasi fakta
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CircleCheckBig aria-hidden className="h-4 w-4 text-emerald-600" />
                Bisa ganti workspace kapan saja
              </span>
            </div>
          </div>
          <WorkspacePreview />
        </section>

        <section
          id="pilih-workspace"
          aria-labelledby="pilih-workspace-heading"
          className="scroll-mt-8 border-y border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] py-20"
        >
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold tracking-[0.18em] text-violet-600 uppercase dark:text-violet-300">
                Pilih dari pintu masuk Anda
              </p>
              <h2
                id="pilih-workspace-heading"
                className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
              >
                Dua dashboard, satu akun.
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-content-muted)]">
                Pilih peran yang ingin Anda kerjakan hari ini. Anda tidak terkunci: akun yang sama
                dapat membuka workspace Pencari Kerja dan HRD kapan saja.
              </p>
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-2">
              <RoleCard
                role="job-seeker"
                signedIn={signedIn}
                icon={UserRoundSearch}
                eyebrow="Job Seeker"
                title="Pencari Kerja"
                description="Perkuat CV, temukan celah, dan simpan riwayat pengembangan karier."
                features={[
                  'Audit ATS dengan 5 kuota gratis setiap hari',
                  'Peningkatan CV tanpa menambah fakta',
                  'Riwayat audit, enhancement, dan ekspor PDF',
                ]}
              />
              <RoleCard
                role="hrd"
                signedIn={signedIn}
                icon={BriefcaseBusiness}
                eyebrow="HRD / Recruiter"
                title="HRD / Rekruter"
                description="Kelola sesi screening, batch CV, dan evidence kandidat dalam satu dashboard."
                features={[
                  'Lowongan dengan kriteria dan bobot',
                  'Batch hingga 50 CV atau satu ZIP',
                  'Bukti per kriteria dan laporan CSV/PDF',
                ]}
              />
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-violet-600 uppercase dark:text-violet-300">
              Tentang project
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              AI menunjukkan bukti, bukan menebak orangnya.
            </h2>
            <p className="mt-4 text-sm leading-7 text-[var(--color-content-muted)]">
              Model bahasa mengekstrak kutipan dan sinyal dari dokumen. Engine deterministik
              menghitung skor, sementara setiap rekomendasi tetap dapat ditelusuri ke sumbernya.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Scale,
                title: 'Deterministik',
                detail: 'Aturan skor stabil dan dapat direproduksi.',
              },
              {
                icon: Fingerprint,
                title: 'Berbasis bukti',
                detail: 'Kutipan diverifikasi sebelum dipakai.',
              },
              {
                icon: Coins,
                title: 'Transparan',
                detail: 'Harga kredit dan ledger terlihat jelas.',
              },
            ].map(({ icon: Icon, title, detail }) => (
              <article
                key={title}
                className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--color-content-muted)]">{detail}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between gap-4 px-5 py-8 text-sm text-[var(--color-content-muted)] sm:flex-row sm:items-center sm:px-8">
          <p>AI Skill Evidence Builder · Evidence before assumption.</p>
          <div className="flex gap-4">
            <Link to="/testimonials" className="hover:text-[var(--color-content)]">
              Testimoni
            </Link>
            <Link to="/credits" className="hover:text-[var(--color-content)]">
              Kredit
            </Link>
            <Link to="/signin" className="hover:text-[var(--color-content)]">
              Masuk
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
