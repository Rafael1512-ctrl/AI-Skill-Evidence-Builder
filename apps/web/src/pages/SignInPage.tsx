import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInSchema, signUpSchema } from '@aseb/shared';
import type { ZodError } from 'zod';

import { ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

type Tab = 'sign-in' | 'sign-up';
type Pending = 'password' | 'google' | null;

const inputClassName =
  'rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]';

function validationMessage(error: ZodError): string {
  return error.issues[0]?.message ?? 'Data yang dikirim tidak valid.';
}

function failureMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return 'Tidak dapat masuk. Silakan coba lagi.';
}

/**
 * Sign-in page.
 *
 * Supabase performs every credential check: Google OAuth and (when configured)
 * email/password sign-in and sign-up. When the browser has no Supabase configuration
 * the page falls back to the API's `AUTH_DEV_MODE` endpoints, which are offline-only,
 * so this page is convenience rather than a security boundary.
 */
export function SignInPage() {
  const { signIn, signUp, signInWithGoogle, status, mode, authError } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    if (status === 'signed-in') navigate('/profile', { replace: true });
  }, [status, navigate]);

  function switchTab(next: Tab): void {
    setTab(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (tab === 'sign-up') {
      const parsed = signUpSchema.safeParse({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
      });
      if (!parsed.success) {
        setError(validationMessage(parsed.error));
        return;
      }

      setPending('password');
      try {
        const outcome = await signUp(parsed.data);
        if (outcome.needsEmailConfirmation) {
          setNotice('Akun dibuat. Buka tautan konfirmasi di email Anda, lalu masuk.');
          setTab('sign-in');
          setPassword('');
        }
        // Navigation is driven by the auth status effect, so a session that never
        // materialises (unconfirmed email, rejected session) cannot land on /profile.
      } catch (cause) {
        setError(failureMessage(cause));
      } finally {
        setPending(null);
      }
      return;
    }

    const parsed = signInSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError(validationMessage(parsed.error));
      return;
    }

    setPending('password');
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setPending(null);
    }
  }

  async function handleGoogle(): Promise<void> {
    setError(null);
    setNotice(null);
    setPending('google');
    try {
      // On success the browser leaves for Google; this stays pending until then.
      await signInWithGoogle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tidak dapat memulai masuk dengan Google.');
      setPending(null);
    }
  }

  const displayedError =
    error ??
    authError ??
    (status === 'error' ? 'Tidak dapat memuat profil. Silakan coba lagi.' : null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Masuk</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Gunakan akun Anda untuk mengelola profil dan kredit.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleGoogle}
          disabled={pending !== null || mode === 'dev'}
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-2 font-medium disabled:opacity-60"
        >
          {pending === 'google' ? 'Menghubungkan ke Google…' : 'Lanjutkan dengan Google'}
        </button>
        {mode === 'dev' ? (
          <p className="text-xs text-[var(--color-content-muted)]">
            Masuk dengan Google memerlukan konfigurasi Supabase (VITE_SUPABASE_URL dan
            VITE_SUPABASE_ANON_KEY), sehingga tombol ini belum aktif di lingkungan ini.
          </p>
        ) : null}
      </div>

      <p className="text-center text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
        atau email dan kata sandi
      </p>

      <div role="tablist" aria-label="Pilih mode" className="flex gap-2">
        {(
          [
            ['sign-in', 'Masuk'],
            ['sign-up', 'Daftar'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => switchTab(value)}
            className={
              tab === value
                ? 'rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-[var(--color-brand-contrast)]'
                : 'rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium'
            }
          >
            {label}
          </button>
        ))}
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {tab === 'sign-up' ? (
          <label className="flex flex-col gap-1 text-sm" htmlFor="fullName">
            <span className="font-medium">Nama lengkap</span>
            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className={inputClassName}
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm" htmlFor="email">
          <span className="font-medium">Email</span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClassName}
          />
        </label>

        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm" htmlFor="password">
            <span className="font-medium">Kata sandi</span>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={tab === 'sign-up' ? 'new-password' : 'current-password'}
              aria-describedby={tab === 'sign-up' ? 'password-hint' : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClassName}
            />
          </label>
          {tab === 'sign-up' ? (
            <p id="password-hint" className="text-xs text-[var(--color-content-muted)]">
              Minimal 8 karakter.
            </p>
          ) : null}
        </div>

        {displayedError ? (
          <p
            role="alert"
            className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
          >
            {displayedError}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]"
          >
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending !== null}
          className="rounded-lg bg-[var(--color-brand)] px-4 py-2 font-medium text-[var(--color-brand-contrast)] disabled:opacity-60"
        >
          {pending === 'password' ? 'Memproses…' : tab === 'sign-up' ? 'Daftar' : 'Masuk'}
        </button>
      </form>

      <p className="text-sm text-[var(--color-content-muted)]">
        {tab === 'sign-in' ? (
          <>
            Belum punya akun?{' '}
            <button
              type="button"
              onClick={() => switchTab('sign-up')}
              className="font-medium text-[var(--color-brand)]"
            >
              Daftar
            </button>
          </>
        ) : (
          <>
            Sudah punya akun?{' '}
            <button
              type="button"
              onClick={() => switchTab('sign-in')}
              className="font-medium text-[var(--color-brand)]"
            >
              Masuk
            </button>
          </>
        )}
      </p>

      {mode === 'dev' ? (
        <p className="text-xs text-[var(--color-content-muted)]">
          Mode pengembangan lokal aktif: kredensial diverifikasi oleh API (
          <code>AUTH_DEV_MODE</code>
          ), bukan oleh Supabase.
        </p>
      ) : null}

      <p className="text-sm text-[var(--color-content-muted)]">
        <Link to="/" className="font-medium text-[var(--color-brand)]">
          Kembali ke beranda
        </Link>
      </p>
    </main>
  );
}
