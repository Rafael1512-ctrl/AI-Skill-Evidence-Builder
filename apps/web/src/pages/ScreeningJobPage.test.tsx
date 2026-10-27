import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCREENING_METHODOLOGY_NOTE } from '@aseb/shared';

import { AuthProvider } from '../lib/auth.js';
import {
  configureSupabaseEnv,
  resetSupabaseMock,
  setSupabaseSession,
} from '../test/supabase-mock.js';
import { ScreeningJobPage } from './ScreeningJobPage.js';

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

const JOB_SUMMARY = {
  id: 'job-1',
  title: 'Backend Engineer',
  state: 'COMPLETED',
  totalCandidates: 2,
  queuedCandidates: 0,
  processingCandidates: 0,
  completedCandidates: 2,
  failedCandidates: 0,
  creditsReserved: 0,
  creditsCharged: 2,
  categoryWeights: null,
  scoringConfigurationVersion: '1.0.0',
  preferenceVersion: 0,
  createdAt: '2026-09-26T09:00:00.000Z',
  startedAt: '2026-09-26T09:01:00.000Z',
  completedAt: '2026-09-26T09:05:00.000Z',
};

const JOB_DETAIL = {
  ...JOB_SUMMARY,
  description: 'Kami mencari backend engineer berpengalaman dengan Node.js dan PostgreSQL.',
  screeningNotes: null,
  requirementVersion: 1,
  promptVersion: 'HRD_SCREENING_V1',
  failureReason: null,
  cancelledAt: null,
  updatedAt: '2026-09-26T09:05:00.000Z',
  requirements: [
    {
      id: 'req-1',
      sortOrder: 1,
      text: 'Pengalaman Node.js',
      category: 'TECHNICAL_SKILLS',
      requirementClass: 'REQUIRED',
      weight: 60,
      hardRequirement: true,
    },
  ],
};

const CRITERION_FOUND = {
  requirementId: 'req-1',
  criterion: 'Pengalaman Node.js',
  category: 'TECHNICAL_SKILLS',
  requirementClass: 'REQUIRED',
  weight: 60,
  normalisedWeight: 1,
  hardRequirement: true,
  status: 'FOUND',
  verificationStatus: 'NOT_CHECKED',
  confidence: 0.9,
  earnedScore: 100,
  evidence: [
    {
      quote: 'lima tahun pengalaman Node.js',
      source: 'CV',
      page: null,
      url: null,
      note: null,
    },
  ],
  notes: '',
};

const CANDIDATE_ANDI = {
  candidateId: 'cand-1',
  candidateName: 'Andi Pratama',
  fileName: 'andi.pdf',
  processingStatus: 'COMPLETED',
  score: 100,
  eligibilityStatus: 'HIGH_MATCH',
  criteriaResults: [CRITERION_FOUND],
  requiredCriteria: [CRITERION_FOUND],
  preferredCriteria: [],
  bonusCriteria: [],
  evidence: CRITERION_FOUND.evidence,
  strengths: ['Pengalaman Node.js'],
  gaps: [],
  uncertainties: [],
  unmetHardRequirements: [],
  portfolioEvidence: [],
  githubEvidence: [],
  verificationStatus: 'NOT_CHECKED',
  summary: 'Ringkasan hasil untuk Andi.',
  generatedAt: '2026-09-26T09:05:00.000Z',
  scoringConfigurationVersion: '1.0.0',
  preferenceVersion: 0,
  failureReason: null,
};

const CANDIDATE_BUDI = {
  ...CANDIDATE_ANDI,
  candidateId: 'cand-2',
  candidateName: 'Budi Santoso',
  fileName: 'budi.pdf',
  score: null,
  eligibilityStatus: 'REQUIREMENT_NOT_MET',
  criteriaResults: [
    {
      ...CRITERION_FOUND,
      status: 'NOT_FOUND',
      confidence: 0.2,
      earnedScore: 0,
      evidence: [],
      notes: 'Ekstraksi tidak memberikan putusan untuk kriteria ini.',
    },
  ],
  requiredCriteria: [],
  evidence: [],
  strengths: [],
  gaps: ['Pengalaman Node.js'],
  unmetHardRequirements: ['Pengalaman Node.js'],
  summary: 'Tidak ada bukti pendukung.',
};

const fetchMock = vi.fn();

const PRICING = [
  {
    feature: 'EVIDENCE_VERIFICATION',
    credits: 2,
    label: 'Verifikasi Bukti',
    description: 'Pemeriksaan bukti tambahan seperti GitHub atau portofolio untuk satu CV.',
    isOverride: false,
    sortOrder: 60,
    updatedAt: null,
  },
];

function walletBody({
  available = 10,
  balance = available,
  reserved = 0,
}: { available?: number; balance?: number; reserved?: number } = {}) {
  return {
    data: {
      id: 'wallet-1',
      userId: 'user-1',
      balance,
      reserved,
      available,
      lifetimeCreditsIn: balance,
      lifetimeCreditsSpent: 0,
      updatedAt: '2026-09-26T00:00:00.000Z',
    },
  };
}

function estimateBody(
  overrides: Partial<{
    disabled: boolean;
    unitCredits: number;
    eligibleCount: number;
    totalCredits: number;
    available: number;
    sufficient: boolean;
    shortfall: number;
  }> = {},
) {
  const available = overrides.available ?? 10;
  const totalCredits = overrides.totalCredits ?? 4;
  return {
    data: {
      estimate: {
        feature: 'EVIDENCE_VERIFICATION',
        disabled: overrides.disabled ?? false,
        unitCredits: overrides.unitCredits ?? 2,
        eligibleCount: overrides.eligibleCount ?? 2,
        totalCredits,
        alreadyVerifiedCount: 0,
        inProgressCount: 0,
        noLinkCount: 0,
        balance: available,
        reserved: 0,
        available,
        sufficient: overrides.sufficient ?? true,
        shortfall: overrides.shortfall ?? 0,
        candidates: [
          { candidateId: 'cand-1', candidateName: 'Andi Pratama' },
          { candidateId: 'cand-2', candidateName: 'Budi Santoso' },
        ],
      },
    },
  };
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function respondWith({
  job = JOB_DETAIL,
  candidates = [CANDIDATE_ANDI, CANDIDATE_BUDI],
  wallet,
  estimate,
}: {
  job?: unknown;
  candidates?: unknown[];
  wallet?: Parameters<typeof walletBody>[0];
  estimate?: Parameters<typeof estimateBody>[0];
} = {}) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.includes('/api/profile')) {
      return jsonResponse({
        data: {
          profile: PROFILE,
          googleLink: { supported: false, reason: null, method: null, redirectTo: null },
        },
      });
    }
    if (url.includes('/api/credits/pricing')) {
      return jsonResponse({ data: PRICING });
    }
    if (url.includes('/api/credits/wallet')) {
      return jsonResponse(walletBody(wallet));
    }
    if (url.includes('/verification/estimate')) {
      return jsonResponse(estimateBody(estimate));
    }
    if (url.includes('/verification') && init?.method === 'POST') {
      if (url.includes('/candidates/')) {
        return jsonResponse({
          data: {
            verification: {
              candidateId: 'cand-1',
              verificationStatus: 'SUPPORTED',
              links: [],
              creditsCharged: 2,
              disabled: false,
            },
          },
        });
      }
      return jsonResponse({
        data: {
          verification: {
            jobId: 'job-1',
            feature: 'EVIDENCE_VERIFICATION',
            unitCredits: 2,
            eligibleCount: 2,
            verifiedCount: 2,
            creditsCharged: 4,
            results: [],
          },
        },
      });
    }
    if (url.includes('/progress')) {
      return jsonResponse({
        data: {
          progress: {
            jobId: 'job-1',
            state: 'COMPLETED',
            total: 2,
            completed: 2,
            failed: 0,
            processing: 0,
            queued: 0,
            percent: 100,
            partialSuccess: false,
            finished: true,
          },
        },
      });
    }
    if (url.includes('/results')) {
      return jsonResponse({
        data: {
          results: {
            job: JOB_SUMMARY,
            methodologyNote: SCREENING_METHODOLOGY_NOTE,
            candidates,
          },
        },
      });
    }
    if (url.includes('/reports')) {
      return jsonResponse({ data: { reports: { items: [], page: 1, pageSize: 10, total: 0 } } });
    }
    return jsonResponse({ data: { job } });
  });
}

function renderJobPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/screening/job-1']}>
          <Routes>
            <Route path="/screening/:jobId" element={<ScreeningJobPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ScreeningJobPage', () => {
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

  it('renders the ranked results with the deterministic score and evidence', async () => {
    respondWith();
    renderJobPage();

    expect(await screen.findByText(/#1 Andi Pratama/)).toBeInTheDocument();
    expect(screen.getByText('100/100')).toBeInTheDocument();
    expect(screen.getByText('Sesuai')).toBeInTheDocument();
    // The evidence panel is collapsed, so its contents appear once expanded.
    expect(screen.getAllByText(/Lihat bukti per kriteria/)).toHaveLength(2);
    expect(screen.getByText(/lima tahun pengalaman Node\.js/)).toBeInTheDocument();
    expect(screen.getByText('Bukti ditemukan')).toBeInTheDocument();
    expect(screen.getByText('Ringkasan hasil untuk Andi.')).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(SCREENING_METHODOLOGY_NOTE.slice(0, 40))),
    ).toBeInTheDocument();
  });

  it('keeps a candidate with an unmet hard requirement visible', async () => {
    respondWith();
    renderJobPage();

    expect(await screen.findByText(/#2 Budi Santoso/)).toBeInTheDocument();
    expect(screen.getByText('Syarat wajib belum terpenuhi')).toBeInTheDocument();
    expect(screen.getAllByText(/Pengalaman Node\.js/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /Syarat wajib belum terpenuhi: Pengalaman Node\.js\. Kandidat tetap ditampilkan\./,
      ),
    ).toBeInTheDocument();
  });

  it('labels an unscored candidate instead of showing a zero', async () => {
    respondWith();
    renderJobPage();

    await screen.findByText(/#2 Budi Santoso/);

    expect(screen.getByText('belum dinilai')).toBeInTheDocument();
    expect(screen.queryByText('0/100')).not.toBeInTheDocument();
  });

  it('shows the upload form while a batch has no candidates', async () => {
    respondWith({
      job: {
        ...JOB_DETAIL,
        state: 'CREATED',
        totalCandidates: 0,
        completedCandidates: 0,
        creditsCharged: 0,
      },
      candidates: [],
    });
    renderJobPage();

    expect(await screen.findByText('Unggah batch CV')).toBeInTheDocument();
    expect(screen.getByLabelText('Berkas CV')).toBeInTheDocument();
    expect(screen.getByText(/Hingga 50 PDF, atau satu ZIP/)).toBeInTheDocument();
  });

  it('surfaces a failed results request instead of an empty table', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/profile')) {
        return jsonResponse({
          data: {
            profile: PROFILE,
            googleLink: { supported: false, reason: null, method: null, redirectTo: null },
          },
        });
      }
      if (url.includes('/results')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Gagal memuat hasil.' } }),
        };
      }
      if (url.includes('/reports')) {
        return jsonResponse({ data: { reports: { items: [], page: 1, pageSize: 10, total: 0 } } });
      }
      return jsonResponse({ data: { job: JOB_DETAIL } });
    });
    renderJobPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat hasil.');
  });

  it('shows verified link evidence and confirms one candidate before spending credits', async () => {
    const withEvidence = {
      ...CANDIDATE_ANDI,
      githubEvidence: [
        {
          quote: 'Repository publik berisi proyek Node.js.',
          source: 'GITHUB',
          page: null,
          url: 'https://github.com/andi',
          note: null,
        },
      ],
    };
    const user = userEvent.setup();
    respondWith({
      candidates: [withEvidence],
      estimate: { eligibleCount: 1, totalCredits: 2, available: 10 },
    });

    renderJobPage();

    expect(await screen.findByText('Bukti dari tautan publik')).toBeInTheDocument();
    expect(screen.getByText(/Repository publik berisi proyek Node\.js\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verifikasi tautan' }));

    // The price and the credit movement are shown before anything is spent.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Verifikasi kandidat ini akan menggunakan 2 kredit. Lanjutkan?',
    );
    expect(dialog).toHaveTextContent('Kredit sebelum');
    expect(dialog).toHaveTextContent('Kredit sesudah');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    expect(
      await screen.findByText(/Status verifikasi: SUPPORTED \(2 kredit\)\./),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/verification'))).toBe(true);
  });

  it('shows the per-candidate price and the balance before any verification is started', async () => {
    respondWith();
    renderJobPage();

    expect(await screen.findByText('Verifikasi tautan: 2 kredit/kandidat')).toBeInTheDocument();
    expect(screen.getByText('Saldo: 10 kredit')).toBeInTheDocument();
    expect(
      await screen.findByText('2 kandidat belum diverifikasi · total 4 kredit'),
    ).toBeInTheDocument();
    // Individual verification stays available alongside the new bulk action.
    expect(screen.getAllByRole('button', { name: 'Verifikasi tautan' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Verifikasi semua' })).toBeEnabled();
  });

  it('lets the user cancel an individual confirmation without spending credits', async () => {
    const user = userEvent.setup();
    respondWith();
    renderJobPage();

    await screen.findByText(/#1 Andi Pratama/);
    const [firstVerifyButton] = screen.getAllByRole('button', { name: 'Verifikasi tautan' });
    await user.click(firstVerifyButton as HTMLElement);

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Verifikasi kandidat ini akan menggunakan 2 kredit. Lanjutkan?',
    );

    await user.click(screen.getByRole('button', { name: 'Batal' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/verification') && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('blocks both verification actions and explains why when the balance is insufficient', async () => {
    respondWith({
      wallet: { available: 0, balance: 0 },
      estimate: {
        eligibleCount: 2,
        totalCredits: 4,
        available: 0,
        sufficient: false,
        shortfall: 4,
      },
    });
    renderJobPage();

    expect(
      await screen.findByText(/Kredit tidak cukup: butuh 4 kredit, tersedia 0 kredit\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verifikasi semua' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Verifikasi tautan' })) {
      expect(button).toBeDisabled();
    }
  });

  it('verifies all eligible candidates in one confirmed action and refreshes the wallet', async () => {
    const user = userEvent.setup();
    respondWith();
    renderJobPage();

    await screen.findByText(/#1 Andi Pratama/);
    const walletCallsBefore = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/credits/wallet'),
    ).length;

    await user.click(screen.getByRole('button', { name: 'Verifikasi semua' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 kandidat belum diverifikasi');
    expect(dialog).toHaveTextContent('Biaya: 2 kredit/kandidat');
    expect(dialog).toHaveTextContent('Total: 4 kredit');
    expect(dialog).toHaveTextContent(
      'Verifikasi 2 kandidat akan menggunakan total 4 kredit. Lanjutkan?',
    );

    await user.click(screen.getByRole('button', { name: 'Lanjutkan' }));

    expect(
      await screen.findByText(/Verifikasi selesai: 2 dari 2 kandidat \(4 kredit\)\./),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('/jobs/job-1/verification') && init?.method === 'POST',
      ),
    ).toBe(true);

    // Success refreshes the wallet, so the "sesudah" balance is read from the server.
    await waitFor(() => {
      const walletCallsAfter = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/credits/wallet'),
      ).length;
      expect(walletCallsAfter).toBeGreaterThan(walletCallsBefore);
    });
  });

  it('disables Verifikasi semua when no candidate is eligible', async () => {
    respondWith({ estimate: { eligibleCount: 0, totalCredits: 0 } });
    renderJobPage();

    await screen.findByText(/#1 Andi Pratama/);
    expect(screen.getByRole('button', { name: 'Verifikasi semua' })).toBeDisabled();
  });
});
