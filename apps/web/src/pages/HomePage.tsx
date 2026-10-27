import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth.js';

/**
 * Landing page.
 *
 * Phase 4 scope: it introduces the two workflows and points at the account surfaces
 * that exist today (sign in, profile). The product workflows themselves arrive later.
 */
export function HomePage() {
  const { profile } = useAuth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium tracking-wide text-[var(--color-brand)] uppercase">
        AI Skill Evidence Builder
      </p>

      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Bangun Karier dengan CV yang Diperkuat AI
      </h1>

      <p className="max-w-2xl text-lg text-[var(--color-content-muted)]">
        Analisis, sempurnakan, dan verifikasi bukti profesional dalam satu platform — untuk pencari
        kerja maupun tim rekrutmen.
      </p>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
          <dt className="font-medium">Pencari Kerja</dt>
          <dd className="mt-1 text-sm text-[var(--color-content-muted)]">
            Audit CV gratis, lalu sempurnakan tanpa menambah fakta yang tidak ada.
          </dd>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
          <dt className="font-medium">HRD / Rekruter</dt>
          <dd className="mt-1 text-sm text-[var(--color-content-muted)]">
            Saring banyak CV dengan bukti yang terlihat untuk setiap kriteria.
          </dd>
        </div>
      </dl>

      <nav className="flex flex-wrap gap-3 text-sm">
        <Link
          to="/audit"
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2 font-medium text-[var(--color-brand-contrast)]"
        >
          Audit CV Gratis
        </Link>
        <Link
          to="/enhance"
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
        >
          Sempurnakan CV
        </Link>
        <Link
          to="/profile"
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
        >
          Profil saya
        </Link>
        <Link
          to="/screening"
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
        >
          Screening HRD
        </Link>
        <Link
          to="/testimonials"
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
        >
          Testimoni
        </Link>
        {profile?.role === 'ADMIN' ? (
          <Link
            to="/admin"
            className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
          >
            Konsol admin
          </Link>
        ) : null}
        <Link
          to="/signin"
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
        >
          Masuk
        </Link>
        <Link
          to="/credits"
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 font-medium"
        >
          Kredit &amp; Harga
        </Link>
      </nav>

      <p className="text-sm text-[var(--color-content-muted)]">
        Antarmuka sedang dibangun bertahap. API tersedia di{' '}
        <code className="rounded bg-[var(--color-surface-muted)] px-1.5 py-0.5">/api/health</code>.
      </p>
    </main>
  );
}
