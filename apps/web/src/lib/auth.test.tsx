import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './auth.js';
import {
  configureSupabaseEnv,
  emitSupabaseAuthEvent,
  removeSupabaseEnv,
  resetSupabaseMock,
  setSupabaseSession,
  supabaseAuth,
} from '../test/supabase-mock.js';

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
  googleConnected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

const GOOGLE_LINK = {
  supported: false,
  reason: null,
  method: null,
  redirectTo: null,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

function respondWithProfile(status = 200): void {
  fetchMock.mockImplementation(async () =>
    status === 200
      ? jsonResponse({ data: { profile: PROFILE, googleLink: GOOGLE_LINK } })
      : jsonResponse(
          { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sesi tidak valid.' } },
          status,
        ),
  );
}

/** Exposes the auth context to assertions and drives its methods from buttons. */
function AuthProbe() {
  const auth = useAuth();
  const [failure, setFailure] = useState('none');

  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="mode">{auth.mode}</span>
      <span data-testid="token">{auth.token ?? 'none'}</span>
      <span data-testid="error">{auth.authError ?? 'none'}</span>
      <span data-testid="failure">{failure}</span>
      <button
        type="button"
        onClick={() => {
          void auth
            .signIn('siti@example.com', 'secret123')
            .catch((cause: unknown) =>
              setFailure(cause instanceof Error ? cause.message : 'error'),
            );
        }}
      >
        masuk
      </button>
      <button
        type="button"
        onClick={() => {
          void auth.signOut();
        }}
      >
        keluar
      </button>
    </div>
  );
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

function authorizationHeader(callIndex = 0): string | undefined {
  const init = fetchMock.mock.calls[callIndex]?.[1] as
    { headers?: Record<string, string> } | undefined;
  return init?.headers?.authorization;
}

describe('AuthProvider with Supabase configured', () => {
  beforeEach(() => {
    resetSupabaseMock();
    configureSupabaseEnv();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('restores the Supabase session on startup and sends its token to the API', async () => {
    setSupabaseSession({ access_token: 'supabase-token-1' });
    respondWithProfile();

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('mode')).toHaveTextContent('supabase');
    expect(screen.getByTestId('token')).toHaveTextContent('supabase-token-1');
    expect(authorizationHeader()).toBe('Bearer supabase-token-1');
  });

  it('keeps the bearer token in sync when Supabase refreshes the session', async () => {
    setSupabaseSession({ access_token: 'supabase-token-1' });
    respondWithProfile();

    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    act(() => {
      emitSupabaseAuthEvent('TOKEN_REFRESHED', { access_token: 'supabase-token-2' });
    });

    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('supabase-token-2'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((_call, index) => authorizationHeader(index))).toContain(
        'Bearer supabase-token-2',
      ),
    );
  });

  it('signs in with email and password through Supabase', async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { session: { access_token: 'password-token' }, user: null },
      error: null,
    });
    respondWithProfile();

    const { user } = renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));

    await user.click(screen.getByRole('button', { name: 'masuk' }));

    expect(supabaseAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'siti@example.com',
      password: 'secret123',
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(authorizationHeader()).toBe('Bearer password-token');
  });

  it('reports a translated Supabase sign-in error instead of signing in', async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'Invalid login credentials' },
    });

    const { user } = renderProbe();
    await user.click(screen.getByRole('button', { name: 'masuk' }));

    await waitFor(() =>
      expect(screen.getByTestId('failure')).toHaveTextContent('Email atau kata sandi salah.'),
    );
    expect(screen.getByTestId('status')).toHaveTextContent('signed-out');
  });

  it('signs out of Supabase and drops the API session', async () => {
    setSupabaseSession({ access_token: 'supabase-token-1' });
    respondWithProfile();

    const { user } = renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));

    await user.click(screen.getByRole('button', { name: 'keluar' }));

    expect(supabaseAuth.signOut).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(screen.getByTestId('token')).toHaveTextContent('none');
  });

  it('discards a session the API rejects with 401', async () => {
    setSupabaseSession({ access_token: 'stale-token' });
    respondWithProfile(401);

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-out'));
    expect(supabaseAuth.signOut).toHaveBeenCalled();
    expect(screen.getByTestId('error')).not.toHaveTextContent('none');
  });
});

describe('AuthProvider without Supabase configuration', () => {
  beforeEach(() => {
    resetSupabaseMock();
    removeSupabaseEnv();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('falls back to the stored development token', async () => {
    window.localStorage.setItem('aseb.access-token', 'dev-token');
    respondWithProfile();

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signed-in'));
    expect(screen.getByTestId('mode')).toHaveTextContent('dev');
    expect(screen.getByTestId('token')).toHaveTextContent('dev-token');
    expect(authorizationHeader()).toBe('Bearer dev-token');
  });
});
