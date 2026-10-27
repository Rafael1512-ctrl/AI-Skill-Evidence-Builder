import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import {
  configureSupabaseEnv,
  resetSupabaseMock,
  setSupabaseSession,
} from '../test/supabase-mock.js';
import { ScreeningPage } from './ScreeningPage.js';

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
};

const JOB = {
  id: 'job-1',
  title: 'Backend Engineer',
  state: 'COMPLETED',
  totalCandidates: 3,
  queuedCandidates: 0,
  processingCandidates: 0,
  completedCandidates: 2,
  failedCandidates: 1,
  creditsReserved: 0,
  creditsCharged: 2,
  categoryWeights: null,
  scoringConfigurationVersion: '1.0.0',
  preferenceVersion: 0,
  createdAt: '2026-09-26T09:00:00.000Z',
  startedAt: '2026-09-26T09:01:00.000Z',
  completedAt: '2026-09-26T09:05:00.000Z',
};

const fetchMock = vi.fn();

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function respondWithJobs(items: unknown[], onCreate?: () => unknown) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.includes('/api/profile')) {
      return jsonResponse({
        data: {
          profile: PROFILE,
          googleLink: { supported: false, reason: null, method: null, redirectTo: null },
        },
      });
    }
    if (url.includes('/api/screening/jobs') && init?.method === 'POST') {
      const job = onCreate
        ? onCreate()
        : {
            ...JOB,
            id: 'job-2',
            state: 'CREATED',
            totalCandidates: 0,
            completedCandidates: 0,
            creditsCharged: 0,
            startedAt: null,
            completedAt: null,
            description: 'Kami mencari backend engineer dengan pengalaman Node.js dan PostgreSQL.',
            screeningNotes: null,
            requirementVersion: 1,
            promptVersion: 'HRD_SCREENING_V1',
            failureReason: null,
            cancelledAt: null,
            updatedAt: '2026-09-26T09:00:00.000Z',
            requirements: [
              {
                id: 'req-1',
                sortOrder: 1,
                text: 'Pengalaman Node.js',
                category: 'TECHNICAL_SKILLS',
                requirementClass: 'REQUIRED',
                weight: 10,
                hardRequirement: false,
              },
            ],
          };
      return { ok: true, status: 201, json: async () => ({ data: { job } }) };
    }
    return jsonResponse({ data: { items, page: 1, pageSize: 20, total: items.length } });
  });
}

function renderScreeningPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/screening']}>
          <Routes>
            <Route path="/screening" element={<ScreeningPage />} />
            <Route path="/screening/:jobId" element={<h1>Sesi baru</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ScreeningPage', () => {
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

  it('lists the recruiter jobs with their progress counts', async () => {
    respondWithJobs([JOB]);
    renderScreeningPage();

    expect(await screen.findByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.getByText(/3 kandidat · 2 selesai · 1 gagal/)).toBeInTheDocument();
    expect(screen.getByText('Selesai')).toBeInTheDocument();
  });

  it('invites the recruiter to create the first session', async () => {
    respondWithJobs([]);
    renderScreeningPage();

    expect(
      await screen.findByText('Belum ada sesi screening. Buat satu untuk mulai mengunggah CV.'),
    ).toBeInTheDocument();
  });

  it('requires a title, a description and at least one criterion', async () => {
    respondWithJobs([]);
    renderScreeningPage();
    const user = userEvent.setup();

    // Wait for the session (the form only renders for a signed-in recruiter).
    await screen.findByLabelText('Posisi');
    await user.click(screen.getByRole('button', { name: 'Buat sesi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Judul minimal 3 karakter.');
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('creates a job from the draft and opens it', async () => {
    respondWithJobs([]);
    renderScreeningPage();
    const user = userEvent.setup();

    await screen.findByLabelText('Posisi');
    await user.type(screen.getByLabelText('Posisi'), 'Backend Engineer');
    await user.type(
      screen.getByLabelText('Deskripsi pekerjaan'),
      'Kami mencari backend engineer dengan pengalaman Node.js dan PostgreSQL.',
    );
    // The criteria label carries an inline hint, so match it as a substring.
    await user.type(screen.getByLabelText(/Kriteria \(satu per baris\)/), 'Pengalaman Node.js');
    await user.click(screen.getByRole('button', { name: 'Buat sesi' }));

    expect(await screen.findByText('Sesi baru')).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as { method?: string })?.method === 'POST',
    );
    expect(post?.[0]).toBe('/api/screening/jobs');
    expect(JSON.parse((post?.[1] as { body: string }).body)).toEqual({
      title: 'Backend Engineer',
      description: 'Kami mencari backend engineer dengan pengalaman Node.js dan PostgreSQL.',
      requirements: [{ text: 'Pengalaman Node.js' }],
      useRecruiterPreferences: true,
    });
  });
});
