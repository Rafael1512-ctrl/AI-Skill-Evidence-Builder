import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import {
  configureSupabaseEnv,
  removeSupabaseEnv,
  resetSupabaseMock,
  supabaseAuth,
} from '../test/supabase-mock.js';
import { SignInPage } from './SignInPage.js';

vi.mock('@supabase/supabase-js', async () => {
  const mock = await import('../test/supabase-mock.js');
  return { createClient: mock.createClientMock } as unknown;
});

const PROFILE = {
  id: 'user-1',
  email: 'siti@example.com',
  emailVerified: true,
  role: 'USER',
  fullName: 'Siti',
  headline: null,
  phone: null,
  location: null,
  avatarUrl: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
  githubUsername: null,
  hasPassword: true,
  googleConnected: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

const fetchMock = vi.fn();

function respondWithProfile(): void {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        profile: PROFILE,
        googleLink: { supported: false, reason: null, method: null, redirectTo: null },
      },
    }),
  }));
}

function renderSignIn() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/signin']}>
          <Routes>
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/profile" element={<p>Halaman profil</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('SignInPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('starts the Google OAuth flow pointed at the profile route', async () => {
    configureSupabaseEnv();
    const { user } = renderSignIn();

    await user.click(screen.getByRole('button', { name: /lanjutkan dengan google/i }));

    expect(supabaseAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/profile` },
    });
  });

  it('shows a loading state while the Google redirect is being prepared', async () => {
    configureSupabaseEnv();
    let release: (() => void) | undefined;
    supabaseAuth.signInWithOAuth.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              data: { provider: 'google', url: 'https://accounts.google.com' },
              error: null,
            });
        }),
    );

    const { user } = renderSignIn();
    await user.click(screen.getByRole('button', { name: /lanjutkan dengan google/i }));

    expect(await screen.findByRole('button', { name: /menghubungkan ke google/i })).toBeDisabled();
    await act(async () => {
      release?.();
    });
  });

  it('signs in with email and password through Supabase', async () => {
    configureSupabaseEnv();
    respondWithProfile();
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { session: { access_token: 'password-token' }, user: null },
      error: null,
    });

    const { user } = renderSignIn();
    await user.type(screen.getByLabelText('Email'), 'siti@example.com');
    await user.type(screen.getByLabelText('Kata sandi'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Masuk' }));

    expect(supabaseAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'siti@example.com',
      password: 'secret123',
    });
    expect(await screen.findByText('Halaman profil')).toBeInTheDocument();
  });

  it('signs up through Supabase and asks for email confirmation when required', async () => {
    configureSupabaseEnv();
    supabaseAuth.signUp.mockResolvedValueOnce({ data: { session: null, user: null }, error: null });

    const { user } = renderSignIn();
    await user.click(screen.getByRole('tab', { name: 'Daftar' }));
    await user.type(screen.getByLabelText('Nama lengkap'), 'Siti Rahma');
    await user.type(screen.getByLabelText('Email'), 'siti@example.com');
    await user.type(screen.getByLabelText('Kata sandi'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Daftar' }));

    expect(supabaseAuth.signUp).toHaveBeenCalledWith({
      email: 'siti@example.com',
      password: 'secret123',
      options: { data: { full_name: 'Siti Rahma' } },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/konfirmasi/i);
    expect(screen.queryByText('Halaman profil')).not.toBeInTheDocument();
  });

  it('validates the sign-up form before contacting Supabase', async () => {
    configureSupabaseEnv();

    const { user } = renderSignIn();
    await user.click(screen.getByRole('tab', { name: 'Daftar' }));
    await user.type(screen.getByLabelText('Nama lengkap'), 'Siti Rahma');
    await user.type(screen.getByLabelText('Email'), 'siti@example.com');
    await user.type(screen.getByLabelText('Kata sandi'), 'short');
    await user.click(screen.getByRole('button', { name: 'Daftar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/minimal 8 karakter/i);
    expect(supabaseAuth.signUp).not.toHaveBeenCalled();
  });

  it('surfaces the provider error left behind by a failed OAuth redirect', async () => {
    configureSupabaseEnv();
    window.location.hash = '#error=access_denied&error_description=Sesi+ditolak';

    renderSignIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Sesi ditolak');
  });

  it('explains the offline development strategy when Supabase is not configured', async () => {
    removeSupabaseEnv();
    renderSignIn();

    await waitFor(() => expect(screen.getByRole('button', { name: /masuk$/i })).toBeEnabled());
    expect(screen.getByRole('button', { name: /lanjutkan dengan google/i })).toBeDisabled();
    expect(screen.getByText(/memerlukan konfigurasi supabase/i)).toBeInTheDocument();
    expect(screen.getByText(/AUTH_DEV_MODE/)).toBeInTheDocument();
  });
});
