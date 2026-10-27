import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../lib/auth.js';

/** Convenience only: every protected API route enforces auth server-side. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, reload } = useAuth();

  // Supabase restores the session asynchronously, so a signed-in visitor reloading the
  // page must not be bounced to /signin before that finishes.
  if (status === 'loading') {
    return (
      <main
        aria-busy="true"
        className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center"
      >
        <p role="status" className="text-sm text-[var(--color-content-muted)]">
          Memuat sesi…
        </p>
      </main>
    );
  }

  if (status === 'signed-out') return <Navigate to="/signin" replace />;

  if (status === 'error') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Tidak dapat memuat profil</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Periksa koneksi Anda, lalu coba lagi.
        </p>
        <button
          type="button"
          onClick={reload}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2 font-medium text-[var(--color-brand-contrast)]"
        >
          Coba lagi
        </button>
      </main>
    );
  }

  return <>{children}</>;
}
