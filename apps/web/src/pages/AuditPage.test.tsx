import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { AuditPage } from './AuditPage.js';

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

const AUDIT_RESULT = {
  atsScore: 72,
  professionalSummary: 'CV terbaca baik, namun pencapaian masih bersifat umum.',
  strengths: ['Struktur pengalaman kerja jelas'],
  weaknesses: ['Belum ada angka yang menunjukkan dampak'],
  missingSections: ['Sertifikasi'],
  keywordAnalysis: [
    { keyword: 'typescript', status: 'PRESENT', note: 'Muncul di bagian keahlian.' },
  ],
  formattingAnalysis: [{ aspect: 'Panjang dokumen', status: 'GOOD', note: '' }],
  improvementSuggestions: [
    {
      title: 'Tambahkan metrik',
      detail: 'Sebutkan jumlah atau persentase dampak pada tiap pencapaian.',
      priority: 'HIGH',
    },
  ],
  careerFit: [{ role: 'Backend Engineer', fit: 70, reason: 'Istilah teknis backend muncul.' }],
  extraction: { pageCount: 1, charCount: 420, detectedLanguage: null, fileName: 'cv.pdf' },
  ephemeral: false,
  analyzedAt: '2026-09-26T10:00:00.000Z',
  provider: 'mock',
  model: 'mock-deterministic-v1',
  promptVersion: 'JOB_SEEKER_AUDIT_V1',
};

const AUDIT_USAGE = {
  freeAuditsLimit: 5,
  freeAuditsUsed: 0,
  freeAuditsRemaining: 5,
  resetsAt: '2026-09-27T17:00:00.000Z',
  paidAuditCredits: 2,
  availableCredits: 0,
};

const FREE_BILLING = {
  mode: 'FREE',
  creditsCharged: 0,
  freeAuditsLimit: 5,
  freeAuditsUsed: 1,
  freeAuditsRemaining: 4,
  resetsAt: '2026-09-27T17:00:00.000Z',
  paidAuditCredits: 2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

function mockSignedInApi(options?: {
  auditBody?: unknown;
  auditStatus?: number;
  usage?: typeof AUDIT_USAGE;
}) {
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
    if (url.startsWith('/api/cv/audit/usage')) {
      return jsonResponse({ data: options?.usage ?? AUDIT_USAGE });
    }
    if (url.startsWith('/api/cv/audit')) {
      return jsonResponse(
        options?.auditBody ?? {
          data: { auditId: 'audit-1', result: AUDIT_RESULT, billing: FREE_BILLING },
        },
        options?.auditStatus ?? 200,
      );
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
}

function renderAudit() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/audit']}>
        <AuthProvider>
          <AuditPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup({ applyAccept: false }) };
}

describe('AuditPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockSignedInApi();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows the five-audit daily quota and the price after it is exhausted', async () => {
    renderAudit();

    expect(screen.getByRole('heading', { name: /^audit cv$/i })).toBeInTheDocument();
    expect(await screen.findByText(/audit gratis tersisa hari ini/i)).toBeInTheDocument();
    expect(screen.getByText(/setelah habis, setiap audit berbiaya 2 kredit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/berkas cv \(pdf/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/cv/audit/usage', expect.anything());
  });

  it('uploads the PDF and renders the structured result', async () => {
    const { user } = renderAudit();

    const file = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/berkas cv \(pdf/i), file);
    await user.click(screen.getByRole('button', { name: /^audit cv$/i }));

    expect(await screen.findByText('Tambahkan metrik')).toBeInTheDocument();
    expect(screen.getByText('Struktur pengalaman kerja jelas')).toBeInTheDocument();
    expect(screen.getByText('Sertifikasi')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText(/72/)).toBeInTheDocument();
    expect(screen.getByText(/tersimpan di akun anda/i)).toBeInTheDocument();
    expect(screen.getByText(/memakai kuota gratis \(1\/5 hari ini\)/i)).toBeInTheDocument();
    expect(screen.getByText(/versi prompt JOB_SEEKER_AUDIT_V1/)).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/api/cv/audit' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(call).toBeDefined();
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('rejects a non-PDF selection before calling the API', async () => {
    const { user } = renderAudit();

    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['nope'], 'cv.txt', { type: 'text/plain' }),
    );
    await user.click(screen.getByRole('button', { name: /^audit cv$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/harus berupa pdf/i);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === '/api/cv/audit' && (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('surfaces an API failure without rendering a partial result', async () => {
    mockSignedInApi({
      auditStatus: 422,
      auditBody: {
        error: {
          code: 'TEXT_EXTRACTION_FAILED',
          message: 'PDF hasil pindai (scan) belum didukung.',
        },
      },
    });
    const { user } = renderAudit();

    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: /^audit cv$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/belum didukung/i);
    expect(screen.getByText(/kode: text_extraction_failed/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /hasil audit cv/i })).not.toBeInTheDocument();
  });

  it('shows the paid action and top-up prompt when the free quota is exhausted', async () => {
    mockSignedInApi({
      usage: { ...AUDIT_USAGE, freeAuditsUsed: 5, freeAuditsRemaining: 0 },
    });
    renderAudit();

    expect(await screen.findByRole('button', { name: /audit cv · 2 kredit/i })).toBeInTheDocument();
    expect(screen.getByText(/kredit tidak cukup untuk audit tambahan/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /isi saldo terlebih dahulu/i })).toHaveAttribute(
      'href',
      '/credits',
    );
  });
});
