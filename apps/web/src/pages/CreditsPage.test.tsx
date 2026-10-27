import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../lib/auth.js';
import { CreditsPage } from './CreditsPage.js';

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

const WALLET = {
  id: 'wallet-1',
  userId: 'user-1',
  balance: 95,
  reserved: 5,
  available: 90,
  lifetimeCreditsIn: 95,
  lifetimeCreditsSpent: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PRICING = [
  {
    feature: 'FREE_CV_AUDIT',
    credits: 0,
    label: 'Audit CV Gratis',
    description: 'Analisis awal CV tanpa biaya kredit.',
    isOverride: false,
    sortOrder: 10,
    updatedAt: null,
  },
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

const PACKAGES = [
  { id: 'credits-50', credits: 50, priceIdr: 50_000, label: '50 Kredit', highlight: false },
  { id: 'credits-100', credits: 100, priceIdr: 100_000, label: '100 Kredit', highlight: true },
];

const PENDING_PAYMENT = {
  id: 'pay-1',
  orderId: 'TOPUP-TEST-1',
  provider: 'mock',
  providerTransactionId: 'MOCK-TOPUP-TEST-1',
  providerReference: 'MOCK-REF-TOPUP-TEST-1',
  status: 'PENDING',
  amountIdr: 50_000,
  credits: 50,
  paymentUrl: null,
  qrString: 'MOCKQRIS:TOPUP-TEST-1',
  expiresAt: '2026-09-27T00:00:00.000Z',
  paidAt: null,
  completedAt: null,
  createdAt: '2026-09-26T00:00:00.000Z',
  failureReason: null,
};

const COMPLETED_PAYMENT = {
  ...PENDING_PAYMENT,
  status: 'COMPLETED',
  paidAt: '2026-09-26T00:05:00.000Z',
  completedAt: '2026-09-26T00:05:00.000Z',
};

const TRANSACTION = {
  id: 'tx-1',
  type: 'TOP_UP',
  amount: 50,
  balanceAfter: 50,
  feature: null,
  description: 'Top-up 50 kredit',
  referenceType: null,
  referenceId: null,
  createdAt: '2026-01-02T03:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const fetchMock = vi.fn();

function mockApi(options: { totalTransactions?: number; paymentItems?: unknown[] } = {}): void {
  const total = options.totalTransactions ?? 1;
  const paymentItems = options.paymentItems ?? [];

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
    if (url.startsWith('/api/credits/wallet')) return jsonResponse({ data: WALLET });
    if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: PRICING });
    if (url.startsWith('/api/credits/packages')) return jsonResponse({ data: PACKAGES });
    if (url.startsWith('/api/credits/transactions')) {
      const page = Number(new URLSearchParams(url.split('?')[1] ?? '').get('page') ?? '1');
      const items = total === 0 ? [] : [TRANSACTION];
      return jsonResponse({
        data: { items, page, pageSize: 20, total },
        meta: { page, pageSize: 20, total },
      });
    }

    if (url.startsWith('/api/payments/checkout')) {
      return jsonResponse({ data: { payment: PENDING_PAYMENT } }, 201);
    }
    if (url.includes('/simulate')) {
      return jsonResponse({ data: { payment: COMPLETED_PAYMENT } });
    }
    if (url.startsWith('/api/payments')) {
      return jsonResponse({
        data: { items: paymentItems, page: 1, pageSize: 5, total: paymentItems.length },
      });
    }

    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan.' } }, 404);
  });
}

function renderCredits() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/credits']}>
        <AuthProvider>
          <CreditsPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('CreditsPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows the public price list and packages to a signed-out visitor', async () => {
    mockApi();
    renderCredits();

    expect(await screen.findByText('Peningkatan CV')).toBeInTheDocument();
    expect(screen.getByText('Audit CV Gratis')).toBeInTheDocument();
    // A zero-credit feature is presented as free rather than "0 Kredit".
    expect(screen.getByText('Gratis')).toBeInTheDocument();
    expect(screen.getByText('100 Kredit')).toBeInTheDocument();
    // Intl renders a non-breaking space, which the matcher does not normalise.
    expect(screen.getByText(/Rp\s*100\.000/)).toBeInTheDocument();

    // No session: the wallet is a prompt and the ledger is absent.
    expect(screen.getByText(/masuk untuk melihat saldo/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /riwayat kredit/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/credits/wallet'),
      expect.anything(),
    );

    // Buying requires an account: the cards are shown, the buy buttons are not.
    expect(screen.queryByRole('button', { name: /top-up/i })).not.toBeInTheDocument();
    expect(screen.getByText(/untuk membeli kredit/i)).toBeInTheDocument();
  });

  it('shows the wallet balance and ledger for a signed-in user', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi();
    renderCredits();

    expect(await screen.findByText('90 Kredit')).toBeInTheDocument();
    expect(screen.getByText('100 Kredit')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: /riwayat kredit/i })).toBeInTheDocument();
    expect(screen.getByText('Top-up')).toBeInTheDocument();
    expect(screen.getByText('+50')).toBeInTheDocument();
    expect(screen.getByText('saldo 50')).toBeInTheDocument();
  });

  it('pages through the ledger', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi({ totalTransactions: 25 });
    const { user } = renderCredits();

    await screen.findByText('Top-up');
    expect(screen.getByText('Halaman 1 dari 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /berikutnya/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything());
    });
    expect(await screen.findByText('Halaman 2 dari 2')).toBeInTheDocument();
    // An empty page keeps the pagination control so the user can go back.
    expect(screen.getByRole('button', { name: /berikutnya/i })).toBeDisabled();
  });

  it('shows an empty state when the ledger has no entries', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi({ totalTransactions: 0 });
    renderCredits();

    expect(await screen.findByText(/belum ada perubahan kredit/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /berikutnya/i })).not.toBeInTheDocument();
  });

  it('surfaces a failed wallet request instead of showing a stale balance', async () => {
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
      if (url.startsWith('/api/credits/wallet')) {
        return jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Gagal.' } }, 500);
      }
      if (url.startsWith('/api/credits/pricing')) return jsonResponse({ data: PRICING });
      if (url.startsWith('/api/credits/packages')) return jsonResponse({ data: PACKAGES });
      return jsonResponse({ data: { items: [], page: 1, pageSize: 20, total: 0 } });
    });

    renderCredits();

    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo kredit tidak dapat dimuat.');
    expect(screen.queryByText(/90 Kredit/)).not.toBeInTheDocument();
  });
  it('starts a top-up and shows the pending payment with its order reference', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi();
    const { user } = renderCredits();

    await user.click(await screen.findByRole('button', { name: /top-up 50 kredit/i }));

    expect(await screen.findByRole('heading', { name: /pembayaran top-up/i })).toBeInTheDocument();
    expect(screen.getByText(/menunggu pembayaran/i)).toBeInTheDocument();
    expect(screen.getByText('TOPUP-TEST-1')).toBeInTheDocument();
    expect(screen.getByText('MOCKQRIS:TOPUP-TEST-1')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/payments/checkout'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ packageId: 'credits-50' }),
        }),
      );
    });
  });

  it('settles an offline payment through the simulation endpoint', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi();
    const { user } = renderCredits();

    await user.click(await screen.findByRole('button', { name: /top-up 50 kredit/i }));
    await user.click(await screen.findByRole('button', { name: /simulasikan pembayaran/i }));

    expect(await screen.findByText(/pembayaran selesai/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/payments/pay-1/simulate'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('lists previous top-up attempts with their status', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi({ paymentItems: [COMPLETED_PAYMENT] });
    renderCredits();

    expect(await screen.findByRole('heading', { name: /riwayat top-up/i })).toBeInTheDocument();
    expect(await screen.findByText('Selesai')).toBeInTheDocument();
    expect(await screen.findByText(/TOPUP-TEST-1/)).toBeInTheDocument();
  });

  it('offers a way back to the landing page', async () => {
    mockApi();
    renderCredits();

    expect(await screen.findByRole('link', { name: /kembali ke beranda/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('refreshes the wallet on demand instead of asking for a page reload', async () => {
    window.localStorage.setItem('aseb.access-token', 'test-token');
    mockApi({ paymentItems: [COMPLETED_PAYMENT] });
    const { user } = renderCredits();

    await screen.findByText('tersedia untuk dipakai');
    const walletCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/credits/wallet')).length;
    const before = walletCalls();

    await user.click(screen.getByRole('button', { name: /muat ulang/i }));

    await waitFor(() => expect(walletCalls()).toBeGreaterThan(before));
  });
});
