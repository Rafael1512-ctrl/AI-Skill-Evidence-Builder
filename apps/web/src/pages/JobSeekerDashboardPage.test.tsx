import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { JobSeekerDashboardPage } from './JobSeekerDashboardPage.js';

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

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/dashboard/job-seeker']}>
          <JobSeekerDashboardPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('JobSeekerDashboardPage', () => {
  beforeEach(() => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/profile')) {
        return jsonResponse({
          data: {
            profile: PROFILE,
            googleLink: { supported: false, reason: null, method: null, redirectTo: null },
          },
        });
      }
      if (url.startsWith('/api/cv/audit/usage')) {
        return jsonResponse({
          data: {
            freeAuditsLimit: 5,
            freeAuditsUsed: 1,
            freeAuditsRemaining: 4,
            resetsAt: '2026-11-04T17:00:00.000Z',
            paidAuditCredits: 2,
            availableCredits: 18,
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
      if (url.startsWith('/api/cv/history')) {
        return jsonResponse({
          data: {
            analyses: [
              {
                id: 'audit-1',
                documentId: 'doc-1',
                kind: 'FREE_AUDIT',
                atsScore: 82,
                fileName: 'cv.pdf',
                provider: 'mock',
                model: 'mock-v1',
                createdAt: '2026-11-04T09:00:00.000Z',
              },
            ],
            enhancements: [
              {
                id: 'enh-1',
                sourceDocumentId: 'doc-2',
                fileName: 'cv.pdf',
                status: 'COMPLETED',
                templateKey: 'ATS_MINIMAL',
                creditsCharged: 5,
                promptVersion: 'JOB_SEEKER_ENHANCE_V1',
                createdAt: '2026-11-04T08:00:00.000Z',
                completedAt: '2026-11-04T08:03:00.000Z',
              },
            ],
            totals: { analyses: 1, enhancements: 1 },
          },
        });
      }
      if (url === '/api/cv/documents/doc-1' && init?.method === 'DELETE') {
        return jsonResponse(null, 204);
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows the job-seeker summary as a distinct workspace', async () => {
    renderDashboard();

    expect(
      await screen.findByRole('heading', { name: /selamat datang, siti/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText('4/5')).toBeInTheDocument();
    expect(await screen.findByText('18 Kredit')).toBeInTheDocument();
    expect(await screen.findByText('Audit CV gratis')).toBeInTheDocument();
    expect(await screen.findByText('Peningkatan CV')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /audit cv baru/i })).toHaveAttribute('href', '/audit');
  });

  it('deletes a stored CV document after confirmation', async () => {
    const { user } = renderDashboard();

    await user.click(await screen.findByRole('button', { name: 'Hapus Audit CV gratis' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Hapus data CV?');
    await user.click(screen.getByRole('button', { name: 'Hapus permanen' }));

    const deletion = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/cv/documents/doc-1' && (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deletion).toBeDefined();
  });
});
