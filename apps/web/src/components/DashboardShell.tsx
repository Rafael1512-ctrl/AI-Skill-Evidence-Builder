import { useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  BriefcaseBusiness,
  Coins,
  FileClock,
  FileSearch,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';

import { formatCredits } from '@aseb/shared';

import { useAuth } from '../lib/auth.js';
import { useWalletQuery } from '../lib/credits.js';

export type DashboardRole = 'job-seeker' | 'hrd';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const WORKSPACES: Record<
  DashboardRole,
  {
    label: string;
    shortLabel: string;
    description: string;
    home: string;
    otherRole: DashboardRole;
    accent: string;
    avatarAccent: string;
    nav: NavItem[];
  }
> = {
  'job-seeker': {
    label: 'Workspace Pencari Kerja',
    shortLabel: 'Job Seeker',
    description: 'Audit, perbaiki, dan kelola dokumen karier Anda.',
    home: '/dashboard/job-seeker',
    otherRole: 'hrd',
    accent: 'bg-violet-600 text-white',
    avatarAccent: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    nav: [
      { label: 'Ringkasan', to: '/dashboard/job-seeker', icon: LayoutDashboard, end: true },
      // `end` keeps these items inactive on their history routes, which have their own entries.
      { label: 'Audit CV', to: '/audit', icon: FileSearch, end: true },
      { label: 'Riwayat Audit', to: '/audit/history', icon: History },
      { label: 'Peningkatan CV', to: '/enhance', icon: Sparkles, end: true },
      { label: 'Riwayat Peningkatan', to: '/enhance/history', icon: FileClock },
    ],
  },
  hrd: {
    label: 'Workspace HRD',
    shortLabel: 'HRD / Recruiter',
    description: 'Kelola lowongan dan screening kandidat berbasis bukti.',
    home: '/dashboard/hrd',
    otherRole: 'job-seeker',
    accent: 'bg-emerald-600 text-white',
    avatarAccent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    nav: [
      { label: 'Ringkasan', to: '/dashboard/hrd', icon: LayoutDashboard, end: true },
      { label: 'Sesi screening', to: '/screening', icon: BriefcaseBusiness },
    ],
  },
};

function navClass(isActive: boolean): string {
  return isActive
    ? 'bg-[var(--color-content)] text-[var(--color-surface)] shadow-sm'
    : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-content)]';
}

function Navigation({ role, onNavigate }: { role: DashboardRole; onNavigate?: () => void }) {
  const workspace = WORKSPACES[role];

  return (
    <nav aria-label={`Navigasi ${workspace.shortLabel}`} className="flex flex-col gap-1">
      {workspace.nav.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${navClass(isActive)}`
            }
          >
            <Icon aria-hidden className="h-4 w-4" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function AccountNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-1 border-t border-[var(--color-border-subtle)] pt-3">
      <NavLink
        to="/credits"
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${navClass(isActive)}`
        }
      >
        <Coins aria-hidden className="h-4 w-4" />
        Kredit &amp; harga
      </NavLink>
      <NavLink
        to="/profile"
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${navClass(isActive)}`
        }
      >
        <UserRound aria-hidden className="h-4 w-4" />
        Profil akun
      </NavLink>
    </div>
  );
}

function WorkspaceSwitcher({ role }: { role: DashboardRole }) {
  const otherRole = WORKSPACES[role].otherRole;
  const target = WORKSPACES[otherRole];

  return (
    <Link
      to={target.home}
      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2.5 text-sm transition hover:border-[var(--color-brand)]"
    >
      <span className="flex items-center gap-2">
        <ArrowLeftRight aria-hidden className="h-4 w-4 text-[var(--color-content-muted)]" />
        <span>
          <span className="block font-medium">Beralih workspace</span>
          <span className="block text-xs text-[var(--color-content-muted)]">
            {target.shortLabel}
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * Shared dashboard chrome for both non-admin workspaces.
 *
 * Role choice is a workspace preference, not an account role: every signed-in account can
 * open either dashboard and spend from the same wallet. Admin navigation is intentionally
 * absent; `/admin` remains reachable only by typing the path and is enforced server-side.
 */
export function DashboardShell({ role, children }: { role: DashboardRole; children: ReactNode }) {
  const workspace = WORKSPACES[role];
  const { profile, signOut } = useAuth();
  const wallet = useWalletQuery();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials =
    profile?.fullName
      ?.split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'AK';

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <Link to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
        <span
          className={`grid h-10 w-10 place-items-center rounded-2xl text-sm font-bold ${workspace.accent}`}
        >
          AS
        </span>
        <span>
          <span className="block text-sm font-semibold tracking-tight">AI Skill Evidence</span>
          <span className="block text-xs text-[var(--color-content-muted)]">Builder</span>
        </span>
      </Link>

      <div className={`rounded-2xl p-4 ${workspace.avatarAccent}`}>
        <p className="text-xs font-semibold tracking-wide uppercase">{workspace.shortLabel}</p>
        <p className="mt-1 text-sm leading-5">{workspace.description}</p>
      </div>

      <Navigation role={role} onNavigate={() => setMobileOpen(false)} />
      <div className="mt-auto flex flex-col gap-3">
        <AccountNavigation onNavigate={() => setMobileOpen(false)} />
        <WorkspaceSwitcher role={role} />
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border-subtle)] p-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${workspace.avatarAccent}`}
            >
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {profile?.fullName ?? 'Akun saya'}
              </span>
              <span className="block truncate text-xs text-[var(--color-content-muted)]">
                {profile?.email}
              </span>
            </span>
          </div>
          <button
            type="button"
            aria-label="Keluar"
            onClick={() => void signOut()}
            className="rounded-lg p-2 text-[var(--color-content-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-content)]"
          >
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[var(--color-surface-muted)]">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 lg:flex">
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-[min(20rem,88vw)] border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5 shadow-2xl">
            <button
              type="button"
              aria-label="Tutup menu"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 rounded-lg p-2 text-[var(--color-content-muted)]"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Buka menu"
              onClick={() => setMobileOpen(true)}
              className="rounded-xl border border-[var(--color-border-subtle)] p-2 lg:hidden"
            >
              <Menu aria-hidden className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--color-content-muted)] uppercase">
                {workspace.shortLabel}
              </p>
              <p className="text-sm font-semibold">{workspace.label}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/credits"
              className="flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm"
            >
              <Coins aria-hidden className="h-4 w-4 text-amber-600" />
              <span className="hidden text-[var(--color-content-muted)] sm:inline">Kredit</span>
              <strong>{wallet.data ? formatCredits(wallet.data.available) : '—'}</strong>
            </Link>
            <Link
              to="/profile"
              className={`grid h-10 w-10 place-items-center rounded-full text-xs font-semibold ${workspace.avatarAccent}`}
              aria-label="Buka profil"
            >
              {initials}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
