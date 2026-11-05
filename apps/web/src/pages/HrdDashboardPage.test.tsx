import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { HrdDashboardPage } from './HrdDashboardPage.js';

const PROFILE = {
  id: 'user-1',
  email: 'recruiter@example.com',
  emailVerified: true,
  role: 'USER',
  fullName: 'Dewi Lestari',
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

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/dashboard/hrd']}>
          <HrdDashboardPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('HrdDashboardPage', () => {
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
      if (url.startsWith('/api/screening/jobs')) {
        return jsonResponse({
          data: {
            items: [
              {
                id: 'job-1',
                title: 'Product Designer',
                state: 'PROCESSING',
                totalCandidates: 8,
                queuedCandidates: 2,
                processingCandidates: 1,
                completedCandidates: 5,
                failedCandidates: 0,
                creditsReserved: 3,
                creditsCharged: 5,
                categoryWeights: null,
                scoringConfigurationVersion: '1.0.0',
                preferenceVersion: 1,
                createdAt: '2026-11-04T09:00:00.000Z',
                startedAt: '2026-11-04T09:01:00.000Z',
                completedAt: null,
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
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

  it('shows recruiter-specific metrics and recent screening sessions', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: /halo, dewi/i })).toBeInTheDocument();
    expect(await screen.findByText('Product Designer')).toBeInTheDocument();
    expect(await screen.findByText('5/8 selesai')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Detail' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Detail Product Designer' })).toHaveAttribute(
      'href',
      '/screening/job-1',
    );
    expect(screen.getByRole('link', { name: /buat sesi screening/i })).toHaveAttribute(
      'href',
      '/screening',
    );
  });
});
