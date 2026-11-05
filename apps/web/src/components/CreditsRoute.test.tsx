import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { CreditsRoute } from './CreditsRoute.js';

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
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <CreditsRoute />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreditsRoute', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input).startsWith('/api/profile')) {
        return jsonResponse({
          data: {
            profile: PROFILE,
            googleLink: { supported: false, reason: null, method: null, redirectTo: null },
          },
        });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan.' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('uses the Job Seeker workspace when opened without one, as from the home page', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    renderAt('/credits');

    expect(await screen.findByText('Workspace Pencari Kerja')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /kredit & harga/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /kembali ke beranda/i })).not.toBeInTheDocument();
  });

  it('keeps the HRD workspace and its navigation when the shell links here', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    renderAt('/credits?workspace=hrd');

    expect(await screen.findByText('Workspace HRD')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sesi screening' })).toHaveAttribute(
      'href',
      '/screening',
    );
    expect(screen.getByRole('link', { name: /kredit & harga/i })).toHaveAttribute(
      'href',
      '/credits?workspace=hrd',
    );
    expect(screen.getByRole('link', { name: /profil akun/i })).toHaveAttribute(
      'href',
      '/profile?workspace=hrd',
    );
  });

  it('falls back to the Job Seeker workspace for an unknown value', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    renderAt('/credits?workspace=admin');

    expect(await screen.findByText('Workspace Pencari Kerja')).toBeInTheDocument();
  });

  it('keeps the public page without account navigation for a guest', async () => {
    renderAt('/credits');

    expect(await screen.findByRole('heading', { name: /kredit & harga/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /kembali ke beranda/i })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Workspace Pencari Kerja')).not.toBeInTheDocument();
  });
});
