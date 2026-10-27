import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { EnhancePage } from './EnhancePage.js';

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

const PRICING = [
  {
    feature: 'CV_ENHANCEMENT',
    credits: 5,
    label: 'Peningkatan CV',
    description: 'Penyempurnaan isi CV lengkap dengan pratinjau Before vs After.',
    isOverride: false,
    sortOrder: 30,
    updatedAt: null,
  },
  {
    feature: 'CV_PDF_EXPORT',
    credits: 1,
    label: 'Ekspor PDF',
    description: 'Mencetak CV yang sudah disempurnakan ke PDF dengan template pilihan.',
    isOverride: false,
    sortOrder: 50,
    updatedAt: null,
  },
];

const EXPORT_RESULT = {
  documentId: 'doc-export-1',
  enhancementId: 'enh-1',
  templateKey: 'ATS_MINIMAL',
  fileName: 'Budi_Santoso-ats_minimal.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  pageCount: 1,
  creditsCharged: 1,
  contentBase64: window.btoa('%PDF-1.4 mock export'),
  createdAt: '2026-09-26T10:05:00.000Z',
};

const ENHANCEMENT = {
  id: 'enh-1',
  sourceDocumentId: 'doc-1',
  status: 'COMPLETED',
  options: { templateKey: 'ATS_MINIMAL', useProfileContext: false },
  document: {
    fullName: 'Budi Santoso',
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
    experience: [
      {
        jobTitle: 'Software Engineer',
        company: 'PT Contoh',
        location: null,
        startDate: null,
        endDate: null,
        current: false,
        summary: null,
        bullets: [
          {
            text: 'Membangun layanan web untuk layanan publik.',
            sourceQuote: 'Pengalaman kerja lima tahun membangun aplikasi web',
          },
        ],
      },
    ],
    projects: [],
    skills: { technical: ['TypeScript'], tools: ['Docker'], soft: [] },
    education: [],
    certifications: [],
    languages: [],
    additionalSections: [],
    changeLog: [{ section: 'Pengalaman', changeType: 'REWORDED', description: 'Kalimat dirapikan.' }],
    missingInformation: [
      { section: 'Pengalaman', message: 'Angka pencapaian belum tersedia di CV.' },
    ],
    atsReadinessScore: 78,
  },
  templateKey: 'ATS_MINIMAL',
  creditsCharged: 5,
  createdAt: '2026-09-26T10:00:00.000Z',
  completedAt: '2026-09-26T10:00:05.000Z',
  originalText: 'Budi Santoso\nSoftware Engineer\nPengalaman kerja lima tahun.',
  promptVersion: 'JOB_SEEKER_ENHANCE_V1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderEnhance() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/enhance']}>
        <AuthProvider>
          <EnhancePage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup({ applyAccept: false }) };
}

describe('EnhancePage', () => {
  const createObjectUrl = vi.fn(() => 'blob:cv-export');
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    Object.defineProperty(URL, 'createObjectURL', { writable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('asks a signed-out visitor to sign in first', () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: PRICING }));
    renderEnhance();

    expect(screen.getByRole('heading', { name: /peningkatan cv berbayar/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /masuk atau daftar/i })).toBeInTheDocument();
  });

  it('uploads the CV and shows Before vs After once the paid enhancement completes', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    let submitted: FormData | null = null;
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
      if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: PRICING });
      submitted = init?.body as FormData;
      return jsonResponse({ data: { enhancement: ENHANCEMENT } }, 201);
    });

    const { user } = renderEnhance();

    await screen.findByLabelText(/berkas cv \(pdf/i);
    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    );
    await user.type(screen.getByLabelText(/posisi target/i), 'Backend Engineer');
    await user.click(screen.getByRole('button', { name: /sempurnakan cv/i }));

    expect(await screen.findByText(/sebelum — cv yang anda unggah/i)).toBeInTheDocument();
    expect(screen.getByText(/sesudah — hasil penyempurnaan/i)).toBeInTheDocument();
    expect(screen.getByText('Backend engineer dengan pengalaman lima tahun.')).toBeInTheDocument();
    expect(screen.getByText(/kalimat dirapikan/i)).toBeInTheDocument();
    expect(screen.getByText(/angka pencapaian belum tersedia di cv/i)).toBeInTheDocument();
    expect(screen.getAllByText(/kutipan sumber/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/versi prompt JOB_SEEKER_ENHANCE_V1/)).toBeInTheDocument();
    expect(screen.getAllByText(/5 kredit/).length).toBeGreaterThan(0);

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/cv/enhance'));
    expect(call).toBeDefined();
    expect(submitted).toBeInstanceOf(FormData);
    const options = JSON.parse(String((submitted as unknown as FormData).get('options'))) as Record<
      string,
      unknown
    >;
    expect(options).toMatchObject({
      templateKey: 'ATS_MINIMAL',
      useProfileContext: false,
      targetPosition: 'Backend Engineer',
    });
  });

  it('rejects a non-PDF selection before calling the API', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
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
      return jsonResponse({ data: PRICING });
    });

    const { user } = renderEnhance();
    await screen.findByLabelText(/berkas cv \(pdf/i);

    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['nope'], 'cv.txt', { type: 'text/plain' }),
    );
    await user.click(screen.getByRole('button', { name: /sempurnakan cv/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/harus berupa pdf/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/cv/enhance'))).toBe(false);
  });

  it('sends an explicit consent flag only when the user opts in', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    let submitted: FormData | null = null;
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
      if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: PRICING });
      submitted = init?.body as FormData;
      return jsonResponse({ data: { enhancement: ENHANCEMENT } }, 201);
    });

    const { user } = renderEnhance();
    await screen.findByLabelText(/berkas cv \(pdf/i);

    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByLabelText(/gunakan data profil saya/i));
    await user.click(screen.getByRole('button', { name: /sempurnakan cv/i }));

    await screen.findByText(/sebelum — cv yang anda unggah/i);
    const options = JSON.parse(String((submitted as unknown as FormData).get('options'))) as Record<
      string,
      unknown
    >;
    expect(options.useProfileContext).toBe(true);
  });

  it('points a user with too few credits at the top-up page', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
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
      if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: PRICING });
      return jsonResponse(
        {
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Kredit tidak cukup: dibutuhkan 5 kredit, tersedia 0 kredit.',
          },
        },
        402,
      );
    });

    const { user } = renderEnhance();
    await screen.findByLabelText(/berkas cv \(pdf/i);

    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: /sempurnakan cv/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/kredit tidak cukup/i);
    expect(screen.getByRole('link', { name: /lihat paket kredit/i })).toHaveAttribute(
      'href',
      '/credits',
    );
  });

  it('exports the enhanced CV as a PDF and triggers a download', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
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
      if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: PRICING });
      if (url.includes('/export')) return jsonResponse({ data: { export: EXPORT_RESULT } }, 201);
      expect(init?.method).toBe('POST');
      return jsonResponse({ data: { enhancement: ENHANCEMENT } }, 201);
    });

    const { user } = renderEnhance();
    await screen.findByLabelText(/berkas cv \(pdf/i);

    await user.upload(
      screen.getByLabelText(/berkas cv \(pdf/i),
      new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: /sempurnakan cv/i }));
    await screen.findByText(/sesudah — hasil penyempurnaan/i);

    expect(screen.getByText('1 kredit per unduhan')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /unduh pdf/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Budi_Santoso-ats_minimal.pdf · 1 halaman · 1 kredit',
    );

    const exportCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/export'));
    expect(exportCall).toBeDefined();
    expect(String(exportCall?.[0])).toContain('/api/cv/enhancements/enh-1/export');
    expect((exportCall?.[1] as RequestInit | undefined)?.method).toBe('POST');

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cv-export');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });
});
