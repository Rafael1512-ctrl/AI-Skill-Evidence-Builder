import { useState, type FormEvent } from 'react';
import { Coins, Search, ShieldCheck, UserCog } from 'lucide-react';

import {
  formatCredits,
  formatDateTimeId,
  type AdminUserSummary,
  type UserRole,
} from '@aseb/shared';

import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import {
  useAdjustAdminCreditsMutation,
  useAdminSearchUsersQuery,
  useUpdateAdminUserRoleMutation,
} from '../../lib/admin.js';
import { AdminEmpty, AdminError, AdminPageHeader, AdminPagination, AdminPanel } from './AdminUi.js';

interface PendingRoleChange {
  user: AdminUserSummary;
  role: UserRole;
}

export function AdminUsersPage() {
  const [searchDraft, setSearchDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState<'ALL' | UserRole>('ALL');
  const [query, setQuery] = useState<{ search?: string; role?: UserRole; page: number }>({
    page: 1,
  });
  const users = useAdminSearchUsersQuery({
    search: query.search,
    role: query.role,
    page: query.page,
    pageSize: 20,
  });
  const updateRole = useUpdateAdminUserRoleMutation();
  const adjustCredits = useAdjustAdminCreditsMutation();
  const [pendingRole, setPendingRole] = useState<PendingRoleChange | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [pendingAdjustment, setPendingAdjustment] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setQuery({
      ...(searchDraft.trim() ? { search: searchDraft.trim() } : {}),
      ...(roleDraft !== 'ALL' ? { role: roleDraft } : {}),
      page: 1,
    });
  }

  function confirmRoleChange() {
    if (!pendingRole) return;
    updateRole.mutate(
      { userId: pendingRole.user.id, role: pendingRole.role },
      {
        onSuccess: (updated) => {
          setNotice(`${pendingRole.user.email} sekarang berperan ${updated.role}.`);
          setPendingRole(null);
        },
        onError: (error) => setNotice(error.message),
      },
    );
  }

  function confirmAdjustment() {
    if (!selectedUser) return;
    const amount = Number(adjustmentAmount);
    adjustCredits.mutate(
      {
        userId: selectedUser.id,
        amount,
        reason: adjustmentReason.trim(),
      },
      {
        onSuccess: (result) => {
          setNotice(
            `Saldo ${selectedUser.email} sekarang ${formatCredits(result.wallet.balance)}.`,
          );
          setPendingAdjustment(false);
          setSelectedUser(null);
          setAdjustmentAmount('');
          setAdjustmentReason('');
        },
        onError: (error) => {
          setPendingAdjustment(false);
          setNotice(error.message);
        },
      },
    );
  }

  const adjustmentValue = Number(adjustmentAmount);
  const adjustmentValid =
    Number.isInteger(adjustmentValue) &&
    adjustmentValue !== 0 &&
    Math.abs(adjustmentValue) <= 100_000 &&
    adjustmentReason.trim().length >= 5;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Account operations"
        title="Pengguna dan akses"
        description="Cari akun, tinjau saldo, ubah peran admin, atau catat penyesuaian kredit melalui ledger."
      />

      {notice ? (
        <p className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}

      <AdminPanel title="Cari pengguna" description="Filter berdasarkan nama, email, atau peran.">
        <form onSubmit={applySearch} className="grid gap-3 p-5 md:grid-cols-[1fr_220px_auto]">
          <label className="relative">
            <span className="sr-only">Cari pengguna</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-content-muted)]"
            />
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Nama atau email"
              className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-2 pr-3 pl-9"
            />
          </label>
          <select
            aria-label="Filter peran"
            value={roleDraft}
            onChange={(event) => setRoleDraft(event.target.value as 'ALL' | UserRole)}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="ALL">Semua peran</option>
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button
            type="submit"
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white dark:bg-amber-500 dark:text-slate-950"
          >
            Cari
          </button>
        </form>
      </AdminPanel>

      {selectedUser ? (
        <AdminPanel
          title="Penyesuaian kredit"
          description={`Saldo ${selectedUser.email} saat ini ${formatCredits(selectedUser.balance)}.`}
          actions={
            <button
              type="button"
              onClick={() => setSelectedUser(null)}
              className="text-sm font-medium text-[var(--color-content-muted)]"
            >
              Tutup
            </button>
          }
        >
          <div className="grid gap-3 p-5 md:grid-cols-[180px_1fr_auto]">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Jumlah kredit
              </span>
              <input
                type="number"
                value={adjustmentAmount}
                onChange={(event) => setAdjustmentAmount(event.target.value)}
                placeholder="Contoh: -5 atau 25"
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Alasan audit
              </span>
              <input
                type="text"
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                placeholder="Minimal 5 karakter"
                maxLength={240}
                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
            <button
              type="button"
              disabled={!adjustmentValid || adjustCredits.isPending}
              onClick={() => setPendingAdjustment(true)}
              className="mt-auto rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950"
            >
              Tinjau penyesuaian
            </button>
          </div>
        </AdminPanel>
      ) : null}

      <AdminPanel
        title="Daftar pengguna"
        description="Perubahan peran dan saldo langsung diaudit oleh API."
      >
        {users.isPending ? <p className="px-5 py-8 text-sm">Memuat pengguna…</p> : null}
        {users.isError ? (
          <div className="p-4">
            <AdminError error={users.error} />
          </div>
        ) : null}
        {users.data?.users.items.length === 0 ? (
          <AdminEmpty>Tidak ada pengguna yang cocok.</AdminEmpty>
        ) : null}
        {users.data && users.data.users.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Akun</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Saldo</th>
                  <th className="px-5 py-3 font-medium">Peran</th>
                  <th className="px-5 py-3 text-right font-medium">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {users.data.users.items.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    onRoleChange={(role) => setPendingRole({ user, role })}
                    onAdjust={() => {
                      setSelectedUser(user);
                      setAdjustmentAmount('');
                      setAdjustmentReason('');
                    }}
                    busy={updateRole.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {users.data ? (
          <AdminPagination
            page={users.data.users.page}
            pageSize={users.data.users.pageSize}
            total={users.data.users.total}
            onChange={(page) => setQuery((current) => ({ ...current, page }))}
          />
        ) : null}
      </AdminPanel>

      <ConfirmDialog
        open={pendingRole !== null}
        title="Ubah peran pengguna"
        confirmLabel="Simpan peran"
        busy={updateRole.isPending}
        onConfirm={confirmRoleChange}
        onCancel={() => setPendingRole(null)}
      >
        {pendingRole ? (
          <p>
            Ubah peran <strong>{pendingRole.user.email}</strong> menjadi{' '}
            <strong>{pendingRole.role}</strong>? Akses admin berlaku di server setelah perubahan.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingAdjustment}
        title="Konfirmasi penyesuaian kredit"
        confirmLabel="Catat ke ledger"
        busy={adjustCredits.isPending}
        onConfirm={confirmAdjustment}
        onCancel={() => setPendingAdjustment(false)}
      >
        <p>
          Tambahkan{' '}
          <strong>
            {adjustmentValue > 0 ? '+' : ''}
            {adjustmentValue} kredit
          </strong>{' '}
          untuk <strong>{selectedUser?.email}</strong>.
        </p>
        <p className="text-[var(--color-content-muted)]">{adjustmentReason.trim()}</p>
      </ConfirmDialog>
    </div>
  );
}

function UserRow({
  user,
  onRoleChange,
  onAdjust,
  busy,
}: {
  user: AdminUserSummary;
  onRoleChange: (role: UserRole) => void;
  onAdjust: () => void;
  busy: boolean;
}) {
  const [role, setRole] = useState<UserRole>(user.role);

  return (
    <tr>
      <td className="px-5 py-4">
        <span className="block font-medium">{user.fullName ?? 'Tanpa nama'}</span>
        <span className="block text-xs text-[var(--color-content-muted)]">{user.email}</span>
        <span className="block text-xs text-[var(--color-content-muted)]">
          Dibuat {formatDateTimeId(user.createdAt)}
        </span>
      </td>
      <td className="px-5 py-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
            user.isActive
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-500/10 text-red-700 dark:text-red-300'
          }`}
        >
          <ShieldCheck aria-hidden className="h-3 w-3" />
          {user.isActive ? 'Aktif' : 'Nonaktif'}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
          {user.emailVerified ? 'Email terverifikasi' : 'Email belum terverifikasi'}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className="block font-medium">{formatCredits(user.balance)}</span>
        <span className="block text-xs text-[var(--color-content-muted)]">
          {user.reserved} ditahan
        </span>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <UserCog aria-hidden className="h-4 w-4 text-[var(--color-content-muted)]" />
          <select
            aria-label={`Peran ${user.email}`}
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5"
          >
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button
            type="button"
            disabled={busy || role === user.role}
            onClick={() => onRoleChange(role)}
            className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            Simpan
          </button>
        </div>
      </td>
      <td className="px-5 py-4 text-right">
        <button
          type="button"
          onClick={onAdjust}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs font-medium hover:border-amber-400"
        >
          <Coins aria-hidden className="h-3.5 w-3.5" />
          Sesuaikan kredit
        </button>
      </td>
    </tr>
  );
}
