import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useConnectGoogleMutation, useUpdateProfileMutation } from '../lib/profile.js';
import { isSupabaseAuthConfigured, linkGoogleIdentity } from '../lib/supabase.js';

interface ProfileFormState {
  fullName: string;
  headline: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
}

const EMPTY_FORM: ProfileFormState = {
  fullName: '',
  headline: '',
  phone: '',
  location: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
};

function normalise(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface FieldProps {
  id: keyof ProfileFormState;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}

function Field({ id, label, value, onChange, type = 'text', placeholder }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
      />
    </label>
  );
}

/**
 * Profile settings.
 *
 * Only the fields the API accepts are editable; email, role and credits are shown for
 * context and can never be changed from here. Emptying a field clears it server-side.
 */
export function ProfilePage() {
  const { profile, googleLink, signOut, authError } = useAuth();
  const updateProfile = useUpdateProfileMutation();
  const connectGoogle = useConnectGoogleMutation();

  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      fullName: profile.fullName ?? '',
      headline: profile.headline ?? '',
      phone: profile.phone ?? '',
      location: profile.location ?? '',
      linkedinUrl: profile.linkedinUrl ?? '',
      githubUrl: profile.githubUrl ?? '',
      portfolioUrl: profile.portfolioUrl ?? '',
    });
  }, [profile]);

  function update(field: keyof ProfileFormState, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      await updateProfile.mutateAsync({
        fullName: normalise(form.fullName),
        headline: normalise(form.headline),
        phone: normalise(form.phone),
        location: normalise(form.location),
        linkedinUrl: normalise(form.linkedinUrl),
        githubUrl: normalise(form.githubUrl),
        portfolioUrl: normalise(form.portfolioUrl),
      });
      setStatusMessage('Profil tersimpan.');
    } catch (cause) {
      setErrorMessage(cause instanceof ApiError ? cause.message : 'Gagal menyimpan profil.');
    }
  }

  async function handleConnectGoogle(): Promise<void> {
    setGoogleMessage(null);
    try {
      const result = await connectGoogle.mutateAsync();
      const redirectTo = result.googleLink.redirectTo;
      if (!redirectTo) {
        setGoogleMessage('Tautan Google belum tersedia saat ini.');
        return;
      }
      await linkGoogleIdentity(redirectTo);
    } catch (cause) {
      setGoogleMessage(
        cause instanceof Error ? cause.message : 'Tidak dapat menghubungkan Google.',
      );
    }
  }

  const googleReady = isSupabaseAuthConfigured();
  const googleCanLink = Boolean(googleLink?.supported) && googleReady;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Profil</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {profile?.email} · {profile?.role === 'ADMIN' ? 'Administrator' : 'Pengguna'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/credits"
            className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-medium"
          >
            Kredit
          </Link>
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-medium"
          >
            Keluar
          </button>
        </div>
      </header>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Field
          id="fullName"
          label="Nama lengkap"
          value={form.fullName}
          onChange={(value) => update('fullName', value)}
        />
        <Field
          id="headline"
          label="Headline"
          value={form.headline}
          onChange={(value) => update('headline', value)}
        />
        <Field
          id="phone"
          label="Telepon"
          value={form.phone}
          onChange={(value) => update('phone', value)}
        />
        <Field
          id="location"
          label="Lokasi"
          value={form.location}
          onChange={(value) => update('location', value)}
        />
        <Field
          id="linkedinUrl"
          label="LinkedIn"
          type="url"
          placeholder="https://www.linkedin.com/in/…"
          value={form.linkedinUrl}
          onChange={(value) => update('linkedinUrl', value)}
        />
        <Field
          id="githubUrl"
          label="GitHub"
          type="url"
          placeholder="https://github.com/…"
          value={form.githubUrl}
          onChange={(value) => update('githubUrl', value)}
        />
        <Field
          id="portfolioUrl"
          label="Portofolio"
          type="url"
          placeholder="https://…"
          value={form.portfolioUrl}
          onChange={(value) => update('portfolioUrl', value)}
        />

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-lg bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
          >
            {errorMessage}
          </p>
        ) : null}
        {statusMessage ? (
          <p
            role="status"
            className="rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]"
          >
            {statusMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={updateProfile.isPending}
          className="self-start rounded-lg bg-[var(--color-brand)] px-4 py-2 font-medium text-[var(--color-brand-contrast)] disabled:opacity-60"
        >
          {updateProfile.isPending ? 'Menyimpan…' : 'Simpan profil'}
        </button>
      </form>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
        <h2 className="font-medium">Akun Google</h2>

        {profile?.googleConnected ? (
          <p className="mt-2 text-sm text-[var(--color-content-muted)]">
            Akun Google sudah terhubung. Anda dapat masuk dengan Google kapan saja.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-[var(--color-content-muted)]">
              Hubungkan akun Google agar bisa masuk tanpa kata sandi. Email dan peran akun tidak
              berubah.
            </p>

            {googleLink?.reason ? (
              <p className="mt-2 text-sm text-[var(--color-content-muted)]">{googleLink.reason}</p>
            ) : null}
            {googleLink?.supported && !googleReady ? (
              <p className="mt-2 text-sm text-[var(--color-content-muted)]">
                Aplikasi web belum dikonfigurasi untuk Supabase (VITE_SUPABASE_URL dan
                VITE_SUPABASE_ANON_KEY), sehingga tombol ini belum aktif di lingkungan ini.
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleConnectGoogle}
              disabled={!googleCanLink || connectGoogle.isPending}
              className="mt-3 rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {connectGoogle.isPending ? 'Menghubungkan…' : 'Hubungkan Google'}
            </button>
          </>
        )}

        {(googleMessage ?? authError) ? (
          <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
            {googleMessage ?? authError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
