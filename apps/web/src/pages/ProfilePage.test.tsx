import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { ProfilePage } from './ProfilePage.js';

const PROFILE = {
  id: 'user-1',
  email: 'siti@example.com',
  emailVerified: true,
  role: 'USER',
  fullName: 'Siti',
  headline: 'Backend Engineer',
  phone: null,
  location: 'Jakarta',
  avatarUrl: null,
  linkedinUrl: null,
  githubUrl: 'https://github.com/siti',
  portfolioUrl: null,
  githubUsername: null,
  hasPassword: true,
  googleConnected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

const GOOGLE_UNSUPPORTED = {
  supported: false,
  reason: 'Menghubungkan Google memerlukan konfigurasi Supabase.',
  method: null,
  redirectTo: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

interface FetchInit {
  method?: string;
  body?: string;
}

function respondWithProfile(googleLink: unknown = GOOGLE_UNSUPPORTED): void {
  fetchMock.mockImplementation(async (_input: unknown, init?: FetchInit) => {
    if ((init?.method ?? 'GET') === 'PATCH') {
      const patch = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return jsonResponse({ data: { profile: { ...PROFILE, ...patch } } });
    }
    return jsonResponse({ data: { profile: PROFILE, googleLink } });
  });
}

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/profile']}>
        <AuthProvider>
          <ProfilePage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('ProfilePage', () => {
  beforeEach(() => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('loads the signed-in profile into the form', async () => {
    respondWithProfile();
    renderProfile();

    // The form renders immediately; wait for the profile query to fill it.
    await screen.findByDisplayValue('Siti');
    expect(screen.getByLabelText('Nama lengkap')).toHaveValue('Siti');
    expect(screen.getByLabelText('Headline')).toHaveValue('Backend Engineer');
    expect(screen.getByLabelText('GitHub')).toHaveValue('https://github.com/siti');
    expect(screen.getByText(/siti@example\.com/)).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('saves the form through PATCH and reports success', async () => {
    respondWithProfile();
    const { user } = renderProfile();

    await screen.findByDisplayValue('Siti');
    const name = screen.getByLabelText('Nama lengkap');
    await user.clear(name);
    await user.type(name, 'Siti Rahmawati');
    // Emptying a field must clear the stored value, not leave it untouched.
    await user.clear(screen.getByLabelText('Headline'));
    await user.click(screen.getByRole('button', { name: /simpan profil/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Profil tersimpan.');

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as FetchInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall?.[1] as FetchInit).body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ fullName: 'Siti Rahmawati', headline: null, location: 'Jakarta' });
  });

  it('surfaces a validation error from the API', async () => {
    fetchMock.mockImplementation(async (_input: unknown, init?: FetchInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') {
        return jsonResponse(
          { error: { code: 'VALIDATION_ERROR', message: 'Data yang dikirim tidak valid.' } },
          400,
        );
      }
      return jsonResponse({ data: { profile: PROFILE, googleLink: GOOGLE_UNSUPPORTED } });
    });

    const { user } = renderProfile();
    await screen.findByDisplayValue('Siti');
    await user.click(screen.getByRole('button', { name: /simpan profil/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Data yang dikirim tidak valid.');
  });

  it('explains why Google linking is unavailable and keeps it disabled', async () => {
    respondWithProfile();
    renderProfile();

    expect(await screen.findByText(/memerlukan konfigurasi Supabase/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /hubungkan google/i });
    expect(button).toBeDisabled();
  });

  it('shows the connected state instead of the connect button', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        data: {
          profile: { ...PROFILE, googleConnected: true },
          googleLink: {
            supported: false,
            reason: 'Akun Google sudah terhubung.',
            method: null,
            redirectTo: null,
          },
        },
      }),
    );

    renderProfile();

    expect(await screen.findByText(/sudah terhubung/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hubungkan google/i })).not.toBeInTheDocument();
  });
});
