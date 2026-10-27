import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import {
  CREDIT_ECONOMY,
  formatCredits,
  formatDateTimeId,
  formatIdr,
  type CreditTransactionType,
  type PaymentStatus,
  type PaymentTransaction,
} from '@aseb/shared';

import { useAuth } from '../lib/auth.js';
import {
  useCreditTransactionsQuery,
  usePricingQuery,
  useTopUpPackagesQuery,
  useWalletQuery,
} from '../lib/credits.js';
import {
  useCreateTopUpMutation,
  usePaymentsQuery,
  useSimulateMockPaymentMutation,
} from '../lib/payments.js';

const TRANSACTION_LABELS: Record<CreditTransactionType, string> = {
  TOP_UP: 'Top-up',
  RESERVATION: 'Reservasi',
  RESERVATION_RELEASE: 'Reservasi dilepas',
  USAGE: 'Pemakaian',
  REFUND: 'Pengembalian',
  ADJUSTMENT: 'Penyesuaian',
};

const PAGE_SIZE = 20;

/** Credits are the only currency the user ever sees; rupiah appears only for top-up. */
function CreditAmount({ credits }: { credits: number }) {
  return <span className="font-medium">{credits === 0 ? 'Gratis' : formatCredits(credits)}</span>;
}

function WalletCard() {
  const { status } = useAuth();
  const wallet = useWalletQuery();
  const queryClient = useQueryClient();
  const [isRefreshing, setRefreshing] = useState(false);

  /**
   * The wallet is not the only thing that moves when a top-up settles: the ledger row and the
   * payment status change with it, so a manual refresh reloads all three. Nothing here can make a
   * pending gateway payment settle - only its verified webhook does that - but it removes the need
   * to reload the whole page once the notification has arrived.
   */
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['credits'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  if (status === 'signed-out') {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5">
        <h2 className="font-medium">Dompet kredit</h2>
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          Masuk untuk melihat saldo, riwayat, dan sisa kredit Anda.{' '}
          <Link to="/signin" className="font-medium text-[var(--color-brand)]">
            Masuk
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="wallet-heading"
      className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="wallet-heading" className="font-medium">
          Dompet kredit
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1 text-sm disabled:opacity-60"
        >
          <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Memuat…' : 'Muat ulang'}
        </button>
      </div>

      {wallet.isPending ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">Memuat saldo…</p>
      ) : null}

      {wallet.isError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          Saldo kredit tidak dapat dimuat.
        </p>
      ) : null}

      {wallet.data ? (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <p className="text-3xl font-semibold tracking-tight">
              {formatCredits(wallet.data.available)}
            </p>
            <p className="text-sm text-[var(--color-content-muted)]">tersedia untuk dipakai</p>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--color-content-muted)]">Saldo</dt>
              <dd className="font-medium">{formatCredits(wallet.data.balance)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-muted)]">Ditahan reservasi</dt>
              <dd className="font-medium">{formatCredits(wallet.data.reserved)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-muted)]">Total pernah masuk</dt>
              <dd className="font-medium">{formatCredits(wallet.data.lifetimeCreditsIn)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function PricingSection() {
  const pricing = usePricingQuery();

  return (
    <section aria-labelledby="pricing-heading">
      <h2 id="pricing-heading" className="text-lg font-medium">
        Harga fitur
      </h2>
      <p className="mt-1 text-sm text-[var(--color-content-muted)]">
        Harga dalam kredit. Audit CV pertama selalu gratis.
      </p>

      {pricing.isPending ? (
        <p className="mt-3 text-sm text-[var(--color-content-muted)]">Memuat harga…</p>
      ) : null}

      {pricing.isError ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          Daftar harga tidak dapat dimuat.
        </p>
      ) : null}

      <ul className="mt-3 flex flex-col gap-2">
        {pricing.data?.map((item) => (
          <li
            key={item.feature}
            className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
          >
            <div className="max-w-xl">
              <p className="font-medium">{item.label}</p>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">{item.description}</p>
            </div>
            <CreditAmount credits={item.credits} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  CREATED: 'Dibuat',
  PENDING: 'Menunggu pembayaran',
  PAID: 'Dibayar',
  PROCESSING: 'Sedang diproses',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  EXPIRED: 'Kedaluwarsa',
  REFUNDED: 'Dikembalikan',
};

/** Offline provider marker; the API additionally refuses simulation in production. */
function isOfflinePayment(payment: PaymentTransaction): boolean {
  return payment.provider === 'mock' && (payment.qrString?.startsWith('MOCKQRIS:') ?? false);
}

/**
 * A single top-up attempt: the order reference, how to pay, and (in development) the
 * button that drives the offline provider through the real webhook path.
 */
function PaymentPanel({ payment, onClose }: { payment: PaymentTransaction; onClose: () => void }) {
  const simulate = useSimulateMockPaymentMutation();
  const [error, setError] = useState<string | null>(null);

  const current = simulate.data ?? payment;
  const settled = current.status === 'COMPLETED';

  async function settleOffline() {
    setError(null);
    try {
      await simulate.mutateAsync({ paymentId: payment.id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Simulasi pembayaran gagal.');
    }
  }

  return (
    <div
      aria-labelledby="payment-heading"
      className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-brand)] bg-[var(--color-surface-raised)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="payment-heading" className="font-medium">
            Pembayaran top-up
          </h3>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {PAYMENT_STATUS_LABELS[current.status]} &bull; {formatIdr(current.amountIdr)} untuk{' '}
            {formatCredits(current.credits)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
        >
          Tutup
        </button>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[var(--color-content-muted)]">Kode pesanan</dt>
          <dd className="font-mono text-xs">{current.orderId}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-content-muted)]">Berlaku sampai</dt>
          <dd>{current.expiresAt ? formatDateTimeId(current.expiresAt) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-content-muted)]">Penyedia</dt>
          <dd>{current.provider}</dd>
        </div>
      </dl>

      {current.paymentUrl ? (
        <a
          href={current.paymentUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white"
        >
          Buka halaman pembayaran
        </a>
      ) : null}

      {current.qrString ? (
        <p className="mt-3 break-all rounded-lg border border-[var(--color-border-subtle)] p-3 font-mono text-xs">
          {current.qrString}
        </p>
      ) : null}

      {settled ? (
        <p className="mt-3 text-sm text-[var(--color-success)]">
          Pembayaran selesai. {formatCredits(current.credits)} telah ditambahkan ke dompet Anda.
        </p>
      ) : null}

      {current.failureReason ? (
        <p className="mt-3 text-sm text-[var(--color-danger)]">{current.failureReason}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {isOfflinePayment(current) && !settled ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void settleOffline()}
            disabled={simulate.isPending}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {simulate.isPending ? 'Memproses…' : 'Simulasikan pembayaran (mode pengembangan)'}
          </button>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            Tanpa gateway aktif, tombol ini menandai pembayaran lunas melalui jalur webhook yang
            sama. Kredit hanya bertambah setelah notifikasi terverifikasi.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TopUpSection() {
  const { status } = useAuth();
  const packages = useTopUpPackagesQuery();
  const createTopUp = useCreateTopUpMutation();
  const [active, setActive] = useState<PaymentTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startTopUp(packageId: string) {
    setError(null);
    setActive(null);
    try {
      setActive(await createTopUp.mutateAsync({ packageId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Top-up tidak dapat dimulai.');
    }
  }

  return (
    <section aria-labelledby="packages-heading">
      <h2 id="packages-heading" className="text-lg font-medium">
        Paket top-up
      </h2>
      <p className="mt-1 text-sm text-[var(--color-content-muted)]">
        Minimum top-up {formatIdr(CREDIT_ECONOMY.MIN_TOPUP_IDR)}. Satu kredit setara{' '}
        {formatIdr(CREDIT_ECONOMY.CREDIT_IDR_VALUE)}. Tanpa langganan.
      </p>

      {status !== 'signed-in' ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          <Link to="/signin" className="font-medium text-[var(--color-brand)]">
            Masuk
          </Link>{' '}
          untuk membeli kredit.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {packages.isError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          Paket top-up tidak dapat dimuat.
        </p>
      ) : null}

      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {packages.data?.map((item) => (
          <li
            key={item.id}
            className={`flex flex-col gap-2 rounded-[var(--radius-card)] border p-4 ${
              item.highlight
                ? 'border-[var(--color-brand)] bg-[var(--color-surface-raised)]'
                : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]'
            }`}
          >
            <p className="font-medium">{item.label}</p>
            <p className="text-sm text-[var(--color-content-muted)]">{formatIdr(item.priceIdr)}</p>
            {status === 'signed-in' ? (
              <button
                type="button"
                onClick={() => void startTopUp(item.id)}
                disabled={createTopUp.isPending}
                className="mt-1 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-60"
              >
                {createTopUp.isPending ? 'Memproses…' : `Top-up ${item.label}`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {active ? <PaymentPanel payment={active} onClose={() => setActive(null)} /> : null}
    </section>
  );
}

function PaymentHistorySection() {
  const { status } = useAuth();
  const payments = usePaymentsQuery(1);

  if (status !== 'signed-in') return null;

  return (
    <section aria-labelledby="payments-heading">
      <h2 id="payments-heading" className="text-lg font-medium">
        Riwayat top-up
      </h2>

      {payments.isPending ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">Memuat riwayat top-up…</p>
      ) : null}

      {payments.isError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          Riwayat top-up tidak dapat dimuat.
        </p>
      ) : null}

      {payments.data && payments.data.total === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          Belum ada transaksi top-up.
        </p>
      ) : null}

      {payments.data && payments.data.items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {payments.data.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-sm"
            >
              <div>
                <p className="font-medium">{PAYMENT_STATUS_LABELS[item.status]}</p>
                <p className="text-[var(--color-content-muted)]">
                  {item.orderId} &bull; {formatDateTimeId(item.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">{formatIdr(item.amountIdr)}</p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {formatCredits(item.credits)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TransactionHistory() {
  const { status } = useAuth();
  const [page, setPage] = useState(1);
  const transactions = useCreditTransactionsQuery(page, PAGE_SIZE);

  if (status !== 'signed-in') return null;

  const total = transactions.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading" className="text-lg font-medium">
        Riwayat kredit
      </h2>

      {transactions.isPending ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">Memuat riwayat…</p>
      ) : null}

      {transactions.isError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          Riwayat kredit tidak dapat dimuat.
        </p>
      ) : null}

      {transactions.data && transactions.data.total === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          Belum ada perubahan kredit.
        </p>
      ) : null}

      {transactions.data && transactions.data.items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {transactions.data.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-sm"
            >
              <div>
                <p className="font-medium">{TRANSACTION_LABELS[item.type]}</p>
                <p className="text-[var(--color-content-muted)]">{item.description}</p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {formatDateTimeId(item.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={
                    item.amount < 0
                      ? 'font-medium text-[var(--color-danger)]'
                      : 'font-medium text-[var(--color-success)]'
                  }
                >
                  {item.amount > 0 ? `+${item.amount}` : item.amount}
                </p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  saldo {item.balanceAfter}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Kept outside the list branch: a page can legitimately come back empty. */}
      {transactions.data && totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-60"
          >
            Sebelumnya
          </button>
          <span className="text-[var(--color-content-muted)]">
            Halaman {transactions.data.page} dari {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-60"
          >
            Berikutnya
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Credits and pricing.
 *
 * The price list is public; the wallet and the ledger need a session. Rupiah is shown
 * only for top-up packages, because credits are the only unit users spend.
 */
export function CreditsPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header>
        {/* At the top on purpose: this page is long, and a way back at the bottom would be out of
            reach from the top-up panel. The other pages put the same link last. */}
        <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
          ← Kembali ke beranda
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Kredit &amp; Harga</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Satu dompet kredit untuk pencarian kerja dan rekrutmen. Tanpa langganan.
        </p>
      </header>

      <WalletCard />
      <PricingSection />
      <TopUpSection />
      <PaymentHistorySection />
      <TransactionHistory />
    </main>
  );
}
