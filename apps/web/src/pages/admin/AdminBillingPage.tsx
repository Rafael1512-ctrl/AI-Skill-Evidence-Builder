import { useState } from 'react';
import { CreditCard, ReceiptText, Webhook } from 'lucide-react';

import { formatCredits, formatDateTimeId, formatIdr } from '@aseb/shared';

import {
  useAdminPaymentsQuery,
  useAdminTransactionsQuery,
  useAdminWebhookEventsQuery,
} from '../../lib/admin.js';
import { AdminEmpty, AdminError, AdminPageHeader, AdminPagination, AdminPanel } from './AdminUi.js';

type BillingTab = 'payments' | 'ledger' | 'webhooks';

const TABS: Array<{ id: BillingTab; label: string; icon: typeof CreditCard }> = [
  { id: 'payments', label: 'Pembayaran', icon: CreditCard },
  { id: 'ledger', label: 'Ledger kredit', icon: ReceiptText },
  { id: 'webhooks', label: 'Webhook', icon: Webhook },
];

export function AdminBillingPage() {
  const [tab, setTab] = useState<BillingTab>('payments');

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Money trail"
        title="Keuangan dan idempotensi"
        description="Tinjau pembayaran, pergerakan kredit, dan delivery webhook dari penyedia pembayaran."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                tab === item.id
                  ? 'border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]'
              }`}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'payments' ? <PaymentsTable /> : null}
      {tab === 'ledger' ? <LedgerTable /> : null}
      {tab === 'webhooks' ? <WebhookTable /> : null}
    </div>
  );
}

function PaymentsTable() {
  const [page, setPage] = useState(1);
  const payments = useAdminPaymentsQuery(page);

  return (
    <AdminPanel
      title="Pembayaran"
      description="Semua percobaan checkout, termasuk yang belum selesai atau gagal."
    >
      {payments.isPending ? <p className="px-5 py-8 text-sm">Memuat pembayaran…</p> : null}
      {payments.isError ? (
        <div className="p-4">
          <AdminError error={payments.error} />
        </div>
      ) : null}
      {payments.data?.payments.items.length === 0 ? (
        <AdminEmpty>Belum ada pembayaran.</AdminEmpty>
      ) : null}
      {payments.data && payments.data.payments.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-medium">Order</th>
                <th className="px-5 py-3 font-medium">Pengguna</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Nominal</th>
                <th className="px-5 py-3 font-medium">Kredit</th>
                <th className="px-5 py-3 font-medium">Waktu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {payments.data.payments.items.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-5 py-3">
                    <span className="block font-medium">{payment.orderId}</span>
                    <span className="block text-xs text-[var(--color-content-muted)]">
                      {payment.provider}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{payment.userId}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={payment.status} />
                    {payment.failureReason ? (
                      <span className="mt-1 block text-xs text-red-600">
                        {payment.failureReason}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 font-medium">{formatIdr(payment.amountIdr)}</td>
                  <td className="px-5 py-3">{formatCredits(payment.credits)}</td>
                  <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                    {formatDateTimeId(payment.paidAt ?? payment.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {payments.data ? (
        <AdminPagination
          page={payments.data.payments.page}
          pageSize={payments.data.payments.pageSize}
          total={payments.data.payments.total}
          onChange={setPage}
        />
      ) : null}
    </AdminPanel>
  );
}

function LedgerTable() {
  const [page, setPage] = useState(1);
  const transactions = useAdminTransactionsQuery(page);

  return (
    <AdminPanel
      title="Ledger kredit"
      description="Satu-satunya sumber pergerakan saldo, terbaru lebih dahulu."
    >
      {transactions.isPending ? <p className="px-5 py-8 text-sm">Memuat ledger…</p> : null}
      {transactions.isError ? (
        <div className="p-4">
          <AdminError error={transactions.error} />
        </div>
      ) : null}
      {transactions.data?.transactions.items.length === 0 ? (
        <AdminEmpty>Belum ada transaksi kredit.</AdminEmpty>
      ) : null}
      {transactions.data && transactions.data.transactions.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-medium">Waktu</th>
                <th className="px-5 py-3 font-medium">Pengguna</th>
                <th className="px-5 py-3 font-medium">Jenis</th>
                <th className="px-5 py-3 font-medium">Perubahan</th>
                <th className="px-5 py-3 font-medium">Setelah</th>
                <th className="px-5 py-3 font-medium">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {transactions.data.transactions.items.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                    {formatDateTimeId(transaction.createdAt)}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{transaction.userId}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={transaction.type} />
                  </td>
                  <td
                    className={`px-5 py-3 font-semibold ${
                      transaction.amount >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {transaction.amount > 0 ? '+' : ''}
                    {transaction.amount}
                  </td>
                  <td className="px-5 py-3">{formatCredits(transaction.balanceAfter)}</td>
                  <td className="max-w-sm px-5 py-3 text-xs text-[var(--color-content-muted)]">
                    {transaction.description}
                    {transaction.feature ? (
                      <span className="block font-medium">{transaction.feature}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {transactions.data ? (
        <AdminPagination
          page={transactions.data.transactions.page}
          pageSize={transactions.data.transactions.pageSize}
          total={transactions.data.transactions.total}
          onChange={setPage}
        />
      ) : null}
    </AdminPanel>
  );
}

function WebhookTable() {
  const [page, setPage] = useState(1);
  const events = useAdminWebhookEventsQuery(page);

  return (
    <AdminPanel
      title="Webhook pembayaran"
      description="Delivery yang ditolak atau gagal diproses juga ditampilkan untuk diagnosis."
    >
      {events.isPending ? <p className="px-5 py-8 text-sm">Memuat webhook…</p> : null}
      {events.isError ? (
        <div className="p-4">
          <AdminError error={events.error} />
        </div>
      ) : null}
      {events.data?.events.items.length === 0 ? (
        <AdminEmpty>Belum ada delivery webhook.</AdminEmpty>
      ) : null}
      {events.data && events.data.events.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-medium">Diterima</th>
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Event</th>
                <th className="px-5 py-3 font-medium">Signature</th>
                <th className="px-5 py-3 font-medium">Proses</th>
                <th className="px-5 py-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {events.data.events.items.map((event) => (
                <tr key={event.id}>
                  <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                    {formatDateTimeId(event.receivedAt)}
                  </td>
                  <td className="px-5 py-3">{event.provider}</td>
                  <td className="px-5 py-3 font-medium">{event.eventType}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={event.signatureValid ? 'VALID' : 'REJECTED'} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={event.processed ? 'PROCESSED' : 'PENDING'} />
                  </td>
                  <td className="max-w-xs px-5 py-3 text-xs text-red-600">
                    {event.errorMessage ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {events.data ? (
        <AdminPagination
          page={events.data.events.page}
          pageSize={events.data.events.pageSize}
          total={events.data.events.total}
          onChange={setPage}
        />
      ) : null}
    </AdminPanel>
  );
}

function StatusBadge({ status }: { status: string }) {
  const positive = ['PAID', 'COMPLETED', 'PROCESSED', 'VALID', 'TOP_UP', 'REFUND'].includes(status);
  const negative = ['FAILED', 'EXPIRED', 'REJECTED', 'USAGE'].includes(status);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        positive
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : negative
            ? 'bg-red-500/10 text-red-700 dark:text-red-300'
            : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
      }`}
    >
      {status}
    </span>
  );
}
