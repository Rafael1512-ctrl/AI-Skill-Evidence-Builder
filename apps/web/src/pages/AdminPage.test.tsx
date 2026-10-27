import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import {
  configureSupabaseEnv,
  resetSupabaseMock,
  setSupabaseSession,
} from '../test/supabase-mock.js';
import { AdminPage } from './AdminPage.js';

vi.mock('@supabase/supabase-js', async () => {
  const mock = await import('../test/supabase-mock.js');
  return { createClient: mock.createClientMock } as unknown;
});

function profile(role: 'USER' | 'ADMIN') {
  return {
    id: 'user-1',
    email: 'siti@example.com',
    emailVerified: true,
    role,
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
}

const OVERVIEW = {
  users: { total: 12, newLast7Days: 3, admins: 1 },
  credits: {
    outstanding: 240,
    reserved: 5,
    creditsInLast30Days: 200,
    creditsSpentLast30Days: 12,
  },
  revenue: { paidIdrLast30Days: 150_000, pendingIdr: 50_000, paidTransactionsLast30Days: 3 },
  ai: {
    requestsLast30Days: 40,
    estimatedCostUsdLast30Days: 1.5,
    targetRevenueUsdLast30Days: 3,
    tokensLast30Days: { input: 100, output: 50, cached: 0 },
    byFeature: [{ feature: 'HRD_SCREEN_PER_CV', requests: 30, estimatedCostUsd: 1.2 }],
  },
  screening: {
    totalJobs: 4,
    activeJobs: 1,
    failedCandidates: 1,
    totalCandidates: 9,
    failureRate: 0.11,
  },
  testimonials: { pending: 1, approved: 2, rejected: 0 },
  system: {
    nodeVersion: 'v24.0.0',
    uptimeSeconds: 120,
    database: 'connected',
    redis: 'in-process',
    aiProvider: 'mock',
    paymentProvider: 'mock',
    queueDriver: 'in-process',
    environment: 'test',
  },
};

const PRICING = [
  {
    feature: 'CV_ENHANCEMENT',
    credits: 5,
    label: 'Peningkatan CV',
    description: 'Penyempurnaan isi CV.',
    isOverride: false,
    sortOrder: 30,
    updatedAt: null,
  },
];

const PENDING_TESTIMONIAL = {
  id: 'testi-1',
  rating: 5,
  comment: 'Audit CV-nya membantu sekali.',
  displayName: 'Andi',
  status: 'PENDING',
  createdAt: '2026-09-26T10:00:00.000Z',
  moderatedAt: null,
};

const fetchMock = vi.fn();

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function respond(role: 'USER' | 'ADMIN') {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.includes('/api/profile')) {
      return jsonResponse({
        data: {
          profile: profile(role),
          googleLink: { supported: false, reason: null, method: null, redirectTo: null },
        },
      });
    }
    if (url.includes('/api/admin/overview')) {
      return jsonResponse({ data: { overview: OVERVIEW, pricing: PRICING } });
    }
    if (url.includes('/api/admin/failed-candidates')) {
      return jsonResponse({
        data: {
          failed: {
            items: [
              {
                id: 'cand-1',
                jobId: 'job-1',
                jobTitle: 'Backend Engineer',
                userId: 'user-1',
                candidateName: 'Budi',
                fileName: 'budi.pdf',
                attempts: 3,
                failureReason: 'Penyedia AI tidak tersedia.',
                updatedAt: '2026-09-26T10:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
          },
        },
      });
    }
    if (url.includes('/api/admin/jobs')) {
      return jsonResponse({
        data: { jobs: { items: [], page: 1, pageSize: 20, total: 0 } },
      });
    }
    if (url.includes('/api/admin/pricing/')) {
      return jsonResponse({
        data: {
          pricing: {
            ...PRICING[0],
            credits: 7,
            isOverride: true,
            updatedAt: '2026-09-26T11:00:00.000Z',
          },
        },
      });
    }
    if (url.includes('/api/testimonials/moderation')) {
      return jsonResponse({
        data: {
          testimonials: { items: [PENDING_TESTIMONIAL], page: 1, pageSize: 20, total: 1 },
        },
      });
    }
    if (url.includes('/moderation') && init?.method === 'PATCH') {
      return jsonResponse({
        data: {
          testimonial: {
            ...PENDING_TESTIMONIAL,
            status: 'APPROVED',
            moderatedAt: '2026-09-26T11:00:00.000Z',
          },
        },
      });
    }
    return jsonResponse({ data: {} });
  });
}

function renderAdminPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          <AdminPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AdminPage', () => {
  beforeEach(() => {
    resetSupabaseMock();
    configureSupabaseEnv();
    setSupabaseSession({ access_token: 'token-1' });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('gates the console for a non-admin', async () => {
    respond('USER');
    renderAdminPage();

    expect(await screen.findByText(/Halaman ini hanya untuk admin/)).toBeInTheDocument();
    // No admin request is even attempted for a known non-admin.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/'))).toBe(false);
  });

  it('shows the aggregates for an admin', async () => {
    respond('ADMIN');
    renderAdminPage();

    expect(await screen.findByText('Pengguna')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1 menunggu')).toBeInTheDocument();
    expect(screen.getByText(/DB connected/)).toBeInTheDocument();
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText(/Penyedia AI tidak tersedia/)).toBeInTheDocument();
  });

  it('saves a credit price override', async () => {
    respond('ADMIN');
    renderAdminPage();
    const user = userEvent.setup();

    const input = await screen.findByLabelText('Kredit CV_ENHANCEMENT');
    await user.clear(input);
    await user.type(input, '7');
    await user.click(screen.getByRole('button', { name: 'Simpan' }));

    const put = fetchMock.mock.calls.find(
      ([, init]) => (init as { method?: string })?.method === 'PUT',
    );
    expect(put?.[0]).toBe('/api/admin/pricing/CV_ENHANCEMENT');
    expect(JSON.parse((put?.[1] as { body: string }).body)).toEqual({ credits: 7 });
  });

  it('moderates a pending testimonial', async () => {
    respond('ADMIN');
    renderAdminPage();
    const user = userEvent.setup();

    expect(await screen.findByText('Andi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Setujui' }));

    const patch = fetchMock.mock.calls.find(
      ([, init]) => (init as { method?: string })?.method === 'PATCH',
    );
    expect(patch?.[0]).toBe('/api/testimonials/testi-1/moderation');
    expect(JSON.parse((patch?.[1] as { body: string }).body)).toEqual({ status: 'APPROVED' });
  });
});
