import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { DashboardShell, WorkspaceShell } from './DashboardShell.js';

const PROFILE = {
  id: 'user-1',
  email: 'siti@example.com',
  emailVerified: true,
  role: 'USER',
  fullName: 'Siti Rahma',
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
};

function jsonResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

const fetchMock = vi.fn();

describe('DashboardShell', () => {
  beforeEach(() => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/profile')) {
        return jsonResponse({
          data: {
            profile: PROFILE,
            googleLink: { supported: false, reason: null, method: null, redirectTo: null },
          },
        });
      }
      if (url.startsWith('/api/credits/wallet')) {
        return jsonResponse({
          data: {
            id: 'wallet-1',
            userId: 'user-1',
            balance: 20,
            reserved: 2,
            available: 18,
            lifetimeCreditsIn: 50,
            lifetimeCreditsSpent: 30,
            updatedAt: '2026-11-04T10:00:00.000Z',
          },
        });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows role navigation, shared credits and a workspace switcher without an admin link', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/dashboard/job-seeker']}>
            <DashboardShell role="job-seeker">
              <h1>Konten dashboard</h1>
            </DashboardShell>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('link', { name: 'Audit CV' })).toHaveAttribute('href', '/audit');
    expect(screen.getByRole('link', { name: 'Peningkatan CV' })).toHaveAttribute(
      'href',
      '/enhance',
    );
    expect(screen.getByRole('link', { name: /beralih workspace/i })).toHaveAttribute(
      'href',
      '/dashboard/hrd',
    );
    expect(await screen.findByText('18 Kredit')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
  });

  it.each([
    ['/profile', 'Workspace Pencari Kerja'],
    ['/profile?workspace=hrd', 'Workspace HRD'],
  ])('opens a shared page at %s in the matching workspace', async (path, label) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <WorkspaceShell>
              <h1>Profil</h1>
            </WorkspaceShell>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(label)).toBeInTheDocument();
  });
});
