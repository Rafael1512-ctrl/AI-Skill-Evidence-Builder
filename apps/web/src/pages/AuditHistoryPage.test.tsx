import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { AuditDetailPage } from './AuditDetailPage.js';
import { AuditHistoryPage } from './AuditHistoryPage.js';

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

const RESULT = {
  atsScore: 72,
  professionalSummary: 'CV terbaca baik, namun pencapaian masih bersifat umum.',
  strengths: ['Struktur pengalaman kerja jelas'],
  weaknesses: [],
  missingSections: [],
  keywordAnalysis: [],
  formattingAnalysis: [],
  improvementSuggestions: [],
  careerFit: [],
  extraction: { pageCount: 1, charCount: 420, detectedLanguage: null, fileName: 'cv-siti.pdf' },
  ephemeral: false,
  analyzedAt: '2026-09-26T10:00:00.000Z',
  provider: 'mock',
  model: 'mock-deterministic-v1',
  promptVersion: 'JOB_SEEKER_AUDIT_V1',
};

function historyItem(id: string, fileName: string | null, atsScore: number, kind = 'FREE_AUDIT') {
  return {
    id,
    documentId: `doc-${id}`,
    kind,
    atsScore,
    fileName,
    provider: 'mock',
    model: 'mock-deterministic-v1',
    createdAt: '2026-09-26T10:00:00.000Z',
  };
}

function historyPage(analyses: unknown[], total: number) {
  return { data: { analyses, enhancements: [], totals: { analyses: total, enhancements: 0 } } };
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
    return api(url);
  });
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/audit/history" element={<AuditHistoryPage />} />
            <Route path="/audit/history/:analysisId" element={<AuditDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

function historyRequestHeaders(): Headers {
  const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/cv/history'));
  return new Headers((call?.[1] as RequestInit | undefined)?.headers);
}

describe('audit history', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('aseb.access-token', 'test-token');
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('lists the account audits, free and paid, and links each one to its detail', async () => {
    mockApi(() =>
      jsonResponse(
        historyPage(
          [
            historyItem('audit-2', 'cv-baru.pdf', 81, 'DEEP_ANALYSIS'),
            historyItem('audit-1', null, 64),
          ],
          2,
        ),
      ),
    );
    renderAt('/audit/history');

    const newest = await screen.findByRole('link', { name: /cv-baru\.pdf/i });
    expect(newest).toHaveAttribute('href', '/audit/history/audit-2');
    expect(within(newest).getByText('81')).toBeInTheDocument();
    expect(within(newest).getByText(/audit tambahan/i)).toBeInTheDocument();
    // A row without a file name must still be reachable.
    expect(screen.getByRole('link', { name: /cv tanpa nama/i })).toHaveAttribute(
      'href',
      '/audit/history/audit-1',
    );
    expect(screen.queryByRole('button', { name: /berikutnya/i })).not.toBeInTheDocument();
    // The account is identified by the session, never by anything in the URL.
    expect(historyRequestHeaders().get('authorization')).toBe('Bearer test-token');
  });

  it('points an account with no audits at the audit page', async () => {
    mockApi(() => jsonResponse(historyPage([], 0)));
    renderAt('/audit/history');

    expect(await screen.findByText(/belum ada audit tersimpan/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /audit cv sekarang/i })).toHaveAttribute(
      'href',
      '/audit',
    );
  });

  it('pages through the history', async () => {
    mockApi((url) =>
      jsonResponse(
        historyPage(
          [
            url.includes('page=2')
              ? historyItem('audit-1', 'halaman-dua.pdf', 60)
              : historyItem('audit-2', 'halaman-satu.pdf', 70),
          ],
          11,
        ),
      ),
    );
    const { user } = renderAt('/audit/history');

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
    renderAt('/audit/history');

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak dapat dimuat/i);
    expect(screen.queryByText(/belum ada audit tersimpan/i)).not.toBeInTheDocument();
  });

  it('renders a stored audit with the full result view', async () => {
    mockApi(() =>
      jsonResponse({
        data: {
          id: 'audit-1',
          kind: 'FREE_AUDIT',
          atsScore: 72,
          result: RESULT,
          createdAt: '2026-09-26T10:00:00.000Z',
        },
      }),
    );
    renderAt('/audit/history/audit-1');

    expect(await screen.findByRole('heading', { name: 'cv-siti.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /hasil audit cv/i })).toBeInTheDocument();
    expect(screen.getByText('Struktur pengalaman kerja jelas')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/cv/analyses/audit-1');
  });

  it('shows not found for an audit the API refuses, such as another account', async () => {
    mockApi(() =>
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Analisis CV tidak ditemukan.' } }, 404),
    );
    renderAt('/audit/history/audit-orang-lain');

    expect(await screen.findByRole('alert')).toHaveTextContent(/audit ini tidak ditemukan/i);
    expect(screen.getByRole('link', { name: /kembali ke riwayat audit/i })).toHaveAttribute(
      'href',
      '/audit/history',
    );
  });
});
