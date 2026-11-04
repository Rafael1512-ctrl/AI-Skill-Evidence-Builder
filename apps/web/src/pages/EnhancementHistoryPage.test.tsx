import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { EnhancementDetailPage } from './EnhancementDetailPage.js';
import { EnhancementHistoryPage } from './EnhancementHistoryPage.js';

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

const DOCUMENT = {
  fullName: 'Siti Rahma',
  headline: 'Backend Engineer',
  contact: {
    email: null,
    phone: null,
    location: null,
    linkedinUrl: null,
    githubUrl: null,
    portfolioUrl: null,
  },
  professionalSummary: 'Backend engineer dengan pengalaman lima tahun.',
  experience: [],
  projects: [],
  skills: { technical: ['TypeScript'], tools: [], soft: [] },
  education: [],
  certifications: [],
  languages: [],
  additionalSections: [],
  changeLog: [],
  missingInformation: [],
  atsReadinessScore: 78,
};

const ENHANCEMENT = {
  id: 'enh-1',
  sourceDocumentId: 'doc-1',
  fileName: 'cv-siti.pdf',
  status: 'COMPLETED',
  options: {
    templateKey: 'ATS_MINIMAL',
    useProfileContext: false,
    targetPosition: 'Backend Engineer',
  },
  document: DOCUMENT,
  templateKey: 'ATS_MINIMAL',
  creditsCharged: 5,
  createdAt: '2026-09-26T10:00:00.000Z',
  completedAt: '2026-09-26T10:00:05.000Z',
  originalText: 'Siti Rahma\nSoftware Engineer',
  promptVersion: 'JOB_SEEKER_ENHANCE_V1',
};

function historyItem(id: string, fileName: string | null, status = 'COMPLETED', credits = 5) {
  return {
    id,
    sourceDocumentId: `doc-${id}`,
    fileName,
    status,
    templateKey: 'PROFESSIONAL',
    creditsCharged: credits,
    promptVersion: 'JOB_SEEKER_ENHANCE_V1',
    createdAt: '2026-09-26T10:00:00.000Z',
    completedAt: '2026-09-26T10:00:05.000Z',
  };
}

function historyPage(enhancements: unknown[], total: number) {
  return { data: { analyses: [], enhancements, totals: { analyses: 0, enhancements: total } } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

/** Answers the session lookup, and hands everything else to `api`. */
function mockApi(api: (url: string) => Response) {
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
    if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: [] });
    return api(url);
  });
}

function mockDetail(overrides: Record<string, unknown>) {
  mockApi(() => jsonResponse({ data: { enhancement: { ...ENHANCEMENT, ...overrides } } }));
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/enhance/history" element={<EnhancementHistoryPage />} />
            <Route path="/enhance/history/:enhancementId" element={<EnhancementDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('enhancement history', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('aseb.access-token', 'test-token');
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('lists the account enhancements with their status and links to the detail', async () => {
    mockApi(() =>
      jsonResponse(
        historyPage(
          [historyItem('enh-2', 'cv-baru.pdf'), historyItem('enh-1', null, 'FAILED', 0)],
          2,
        ),
      ),
    );
    renderAt('/enhance/history');

    const newest = await screen.findByRole('link', { name: /cv-baru\.pdf/i });
    expect(newest).toHaveAttribute('href', '/enhance/history/enh-2');
    expect(within(newest).getByText('Selesai')).toBeInTheDocument();
    expect(within(newest).getByText(/professional · 5 kredit/i)).toBeInTheDocument();

    const failed = screen.getByRole('link', { name: /cv tanpa nama/i });
    expect(failed).toHaveAttribute('href', '/enhance/history/enh-1');
    expect(within(failed).getByText('Gagal')).toBeInTheDocument();

    const historyCall = fetchMock.mock.calls.find(([url]) =>
      String(url).startsWith('/api/cv/history'),
    );
    const headers = new Headers((historyCall?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-token');
  });

  it('points an account with no enhancements at the enhance page', async () => {
    mockApi(() => jsonResponse(historyPage([], 0)));
    renderAt('/enhance/history');

    expect(await screen.findByText(/belum ada peningkatan tersimpan/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sempurnakan cv sekarang/i })).toHaveAttribute(
      'href',
      '/enhance',
    );
  });

  it('pages through the history using the enhancement total', async () => {
    mockApi((url) =>
      jsonResponse(
        historyPage(
          [
            url.includes('page=2')
              ? historyItem('enh-1', 'halaman-dua.pdf')
              : historyItem('enh-2', 'halaman-satu.pdf'),
          ],
          11,
        ),
      ),
    );
    const { user } = renderAt('/enhance/history');

    expect(await screen.findByText('halaman-satu.pdf')).toBeInTheDocument();
    expect(screen.getByText('Halaman 1 dari 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /berikutnya/i }));

    expect(await screen.findByText('halaman-dua.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /berikutnya/i })).toBeDisabled();
  });

  it('reports a failed load instead of claiming the history is empty', async () => {
    mockApi(() =>
      jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan.' } }, 500),
    );
    renderAt('/enhance/history');

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak dapat dimuat/i);
    expect(screen.queryByText(/belum ada peningkatan tersimpan/i)).not.toBeInTheDocument();
  });

  it('renders a completed enhancement with Before vs After and the export panel', async () => {
    mockDetail({});
    renderAt('/enhance/history/enh-1');

    expect(await screen.findByRole('heading', { name: 'cv-siti.pdf' })).toBeInTheDocument();
    expect(screen.getByText(/posisi target Backend Engineer/)).toBeInTheDocument();
    expect(screen.getByText(/Software Engineer/)).toBeInTheDocument();
    expect(screen.getByText('Backend engineer dengan pengalaman lima tahun.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unduh pdf/i })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      '/api/cv/enhancements/enh-1',
    );
  });

  it('explains a deleted source CV instead of showing an empty Before panel', async () => {
    mockDetail({ originalText: '', sourceDocumentId: 'doc-1' });
    renderAt('/enhance/history/enh-1');

    expect(await screen.findByText(/teks cv asli sudah dihapus/i)).toBeInTheDocument();
    expect(screen.getByText('Backend engineer dengan pengalaman lima tahun.')).toBeInTheDocument();
  });

  it('offers no result or paid export for a failed enhancement', async () => {
    mockDetail({ status: 'FAILED', document: null, creditsCharged: 0 });
    renderAt('/enhance/history/enh-1');

    expect(
      await screen.findByRole('heading', { name: /peningkatan tidak berhasil/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unduh pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/peningkatan selesai/i)).not.toBeInTheDocument();
  });

  it('says an unfinished enhancement is still processing', async () => {
    mockDetail({ status: 'PROCESSING', document: null, creditsCharged: 0, completedAt: null });
    renderAt('/enhance/history/enh-1');

    expect(
      await screen.findByRole('heading', { name: /peningkatan masih diproses/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unduh pdf/i })).not.toBeInTheDocument();
  });

  it('shows not found for an enhancement the API refuses, such as another account', async () => {
    mockApi(() =>
      jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Hasil peningkatan CV tidak ditemukan.' } },
        404,
      ),
    );
    renderAt('/enhance/history/enh-orang-lain');

    expect(await screen.findByRole('alert')).toHaveTextContent(/peningkatan ini tidak ditemukan/i);
    expect(screen.getByRole('link', { name: /kembali ke riwayat peningkatan/i })).toHaveAttribute(
      'href',
      '/enhance/history',
    );
  });
});
