import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '../lib/auth.js';

interface AdminNavItem {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

const ADMIN_NAV: AdminNavItem[] = [
  {
    label: 'Ringkasan',
    description: 'Kondisi platform hari ini',
    to: '/admin',
    icon: LayoutDashboard,
    end: true,
  },
  {
    label: 'Laporan',
    description: 'Pendapatan, AI, dan kredit',
    to: '/admin/reports',
    icon: BarChart3,
  },
  {
    label: 'Pengguna',
    description: 'Akses, saldo, dan peran',
    to: '/admin/users',
    icon: UsersRound,
  },
  {
    label: 'Keuangan',
    description: 'Pembayaran dan ledger',
    to: '/admin/billing',
    icon: CreditCard,
  },
  {
    label: 'Pemakaian AI',
    description: 'Biaya dan token per panggilan',
    to: '/admin/ai-usage',
    icon: BrainCircuit,
  },
  {
    label: 'Screening',
    description: 'Sesi, kandidat, dan kegagalan',
    to: '/admin/screening',
    icon: BriefcaseBusiness,
  },
  {
    label: 'Harga & moderasi',
    description: 'Harga fitur dan testimoni',
    to: '/admin/settings',
    icon: Settings2,
  },
];

function navigationClass(isActive: boolean): string {
  return isActive
    ? 'border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200'
    : 'border-transparent text-[var(--color-content-muted)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-content)]';
}

function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Navigasi admin" className="flex flex-col gap-1">
      {ADMIN_NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ${navigationClass(isActive)}`
            }
          >
            <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block text-[11px] leading-4 opacity-75">
                {item.description}
              </span>
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/**
 * Admin-only application chrome.
 *
 * The route stays unlinked from the public/workspace navigation. This shell is only a
 * convenience: every backing endpoint still runs `requireAuth` + `requireAdmin` on the server.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { profile, status, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (status !== 'signed-in' || profile?.role !== 'ADMIN') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <Settings2 aria-hidden className="h-5 w-5" />
        </span>
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

  const initials =
    profile.fullName
      ?.split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'AD';

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <Link to="/admin" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-500 text-sm font-bold text-slate-950">
          AS
        </span>
        <span>
          <span className="block text-sm font-semibold tracking-tight">AI Skill Evidence</span>
          <span className="block text-xs text-[var(--color-content-muted)]">Admin console</span>
        </span>
      </Link>

      <div className="rounded-2xl bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
        <p className="text-xs font-semibold tracking-wide uppercase">Operasional platform</p>
        <p className="mt-1 text-sm leading-5">
          Pantau ekonomi kredit, biaya AI, akses akun, dan kualitas pemrosesan.
        </p>
      </div>

      <AdminNavigation onNavigate={() => setMobileOpen(false)} />

      <div className="mt-auto flex flex-col gap-3">
        <NavLink
          to="/profile"
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${navigationClass(isActive)}`
          }
        >
          <UserRound aria-hidden className="h-4 w-4" />
          Profil akun
        </NavLink>
        <Link
          to="/dashboard/job-seeker"
          className="flex items-center justify-between rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2.5 text-sm transition hover:border-amber-400"
        >
          <span>
            <span className="block font-medium">Buka workspace</span>
            <span className="block text-xs text-[var(--color-content-muted)]">Pencari Kerja</span>
          </span>
          <LayoutDashboard aria-hidden className="h-4 w-4 text-[var(--color-content-muted)]" />
        </Link>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border-subtle)] p-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-800 dark:text-amber-200">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {profile.fullName ?? 'Admin'}
              </span>
              <span className="block truncate text-xs text-[var(--color-content-muted)]">
                {profile.email}
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
                Administrator
              </p>
              <p className="text-sm font-semibold">Konsol operasional</p>
            </div>
          </div>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
            ADMIN
          </span>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
