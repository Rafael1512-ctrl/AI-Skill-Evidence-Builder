import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import {
  configureSupabaseEnv,
  removeSupabaseEnv,
  resetSupabaseMock,
  setSupabaseSession,
  supabaseAuth,
} from '../test/supabase-mock.js';
import { ProtectedRoute } from './ProtectedRoute.js';

vi.mock('@supabase/supabase-js', async () => {
  const mock = await import('../test/supabase-mock.js');
  return { createClient: mock.createClientMock } as unknown;
});

const fetchMock = vi.fn();

function respondWithProfile(): void {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        profile: {
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
          googleConnected: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        googleLink: { supported: false, reason: null, method: null, redirectTo: null },
      },
    }),
  }));
}

function renderProtectedRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <Routes>
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <p>Konten terlindungi</p>
                </ProtectedRoute>
              }
            />
            <Route path="/signin" element={<h1>Masuk</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    resetSupabaseMock();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('waits for the Supabase session instead of bouncing the visitor to /signin', async () => {
    configureSupabaseEnv();
    setSupabaseSession({ access_token: 'slow-token' });
    supabaseAuth.getSession.mockImplementationOnce(() => new Promise<never>(() => {}));

    renderProtectedRoute();

    expect(await screen.findByText('Memuat sesi…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Masuk' })).not.toBeInTheDocument();
    expect(screen.queryByText('Konten terlindungi')).not.toBeInTheDocument();
  });

  it('redirects a signed-out visitor to the sign-in route', async () => {
    removeSupabaseEnv();

    renderProtectedRoute();

    expect(await screen.findByRole('heading', { name: 'Masuk' })).toBeInTheDocument();
    expect(screen.queryByText('Konten terlindungi')).not.toBeInTheDocument();
  });

  it('renders the protected content once the session is restored', async () => {
    configureSupabaseEnv();
    setSupabaseSession({ access_token: 'supabase-token' });
    respondWithProfile();

    renderProtectedRoute();

    expect(await screen.findByText('Konten terlindungi')).toBeInTheDocument();
  });
});
