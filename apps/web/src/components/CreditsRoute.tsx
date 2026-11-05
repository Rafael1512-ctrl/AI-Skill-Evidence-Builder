import { useAuth } from '../lib/auth.js';
import { CreditsPage } from '../pages/CreditsPage.js';
import { WorkspaceShell } from './DashboardShell.js';

/**
 * `/credits` for every visitor.
 *
 * Signed-in accounts see it inside the workspace they came from. The price list is public, so
 * guests get the page without the account-only shell.
 */
export function CreditsRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <main
        aria-busy="true"
        className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center"
      >
        <p role="status" className="text-sm text-[var(--color-content-muted)]">
          Memuat sesi…
        </p>
      </main>
    );
  }

  if (status === 'signed-in') {
    return (
      <WorkspaceShell>
        <CreditsPage />
      </WorkspaceShell>
    );
  }

  return (
    <main className="min-h-dvh px-6 py-16">
      <CreditsPage />
    </main>
  );
}
