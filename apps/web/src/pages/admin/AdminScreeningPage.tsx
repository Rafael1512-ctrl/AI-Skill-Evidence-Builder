import { useState } from 'react';
import { BriefcaseBusiness, CircleAlert } from 'lucide-react';

import { formatCredits, formatDateTimeId } from '@aseb/shared';

import { useAdminFailedCandidatesQuery, useAdminJobsQuery } from '../../lib/admin.js';
import { AdminEmpty, AdminError, AdminPageHeader, AdminPagination, AdminPanel } from './AdminUi.js';

export function AdminScreeningPage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Recruitment operations"
        title="Screening dan antrean"
        description="Pantau seluruh sesi lintas akun dan telusuri kandidat yang gagal diproses."
      />
      <JobsPanel />
      <FailedCandidatesPanel />
    </div>
  );
}

function JobsPanel() {
  const [page, setPage] = useState(1);
  const jobs = useAdminJobsQuery(page);

  return (
    <AdminPanel
      title="Sesi screening"
      description="Termasuk pemilik akun, progres kandidat, dan kredit yang tercatat."
    >
      {jobs.isPending ? <p className="px-5 py-8 text-sm">Memuat sesi…</p> : null}
      {jobs.isError ? (
        <div className="p-4">
          <AdminError error={jobs.error} />
        </div>
      ) : null}
      {jobs.data?.jobs.items.length === 0 ? (
        <AdminEmpty>Belum ada sesi screening.</AdminEmpty>
      ) : null}
      {jobs.data && jobs.data.jobs.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-medium">Sesi</th>
                <th className="px-5 py-3 font-medium">Pemilik</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Kandidat</th>
                <th className="px-5 py-3 font-medium">Kredit</th>
                <th className="px-5 py-3 font-medium">Dibuat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {jobs.data.jobs.items.map((job) => (
                <tr key={job.id}>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2 font-medium">
                      <BriefcaseBusiness aria-hidden className="h-4 w-4 text-emerald-600" />
                      {job.title}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-[var(--color-content-muted)]">
                      {job.id}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="block">{job.ownerEmail}</span>
                    <span className="block font-mono text-xs text-[var(--color-content-muted)]">
                      {job.userId}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-1 text-xs font-medium">
                      {job.state}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {job.completedCandidates}/{job.totalCandidates} selesai
                    {job.failedCandidates > 0 ? (
                      <span className="block text-xs text-red-600">
                        {job.failedCandidates} gagal
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3">{formatCredits(job.creditsCharged)}</td>
                  <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                    {formatDateTimeId(job.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {jobs.data ? (
        <AdminPagination
          page={jobs.data.jobs.page}
          pageSize={jobs.data.jobs.pageSize}
          total={jobs.data.jobs.total}
          onChange={setPage}
        />
      ) : null}
    </AdminPanel>
  );
}

function FailedCandidatesPanel() {
  const [page, setPage] = useState(1);
  const failed = useAdminFailedCandidatesQuery(page);

  return (
    <AdminPanel
      title="Kandidat gagal"
      description="Alasan kegagalan dan jumlah percobaan dapat dipakai untuk diagnosis operasional."
    >
      {failed.isPending ? <p className="px-5 py-8 text-sm">Memuat kegagalan…</p> : null}
      {failed.isError ? (
        <div className="p-4">
          <AdminError error={failed.error} />
        </div>
      ) : null}
      {failed.data?.failed.items.length === 0 ? (
        <AdminEmpty>Tidak ada kandidat gagal.</AdminEmpty>
      ) : null}
      {failed.data && failed.data.failed.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-xs text-[var(--color-content-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-medium">Kandidat</th>
                <th className="px-5 py-3 font-medium">Sesi</th>
                <th className="px-5 py-3 font-medium">Percobaan</th>
                <th className="px-5 py-3 font-medium">Alasan</th>
                <th className="px-5 py-3 font-medium">Diperbarui</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {failed.data.failed.items.map((candidate) => (
                <tr key={candidate.id}>
                  <td className="px-5 py-3">
                    <span className="block font-medium">{candidate.candidateName}</span>
                    <span className="block text-xs text-[var(--color-content-muted)]">
                      {candidate.fileName}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="block">{candidate.jobTitle}</span>
                    <span className="block font-mono text-xs text-[var(--color-content-muted)]">
                      {candidate.jobId}
                    </span>
                  </td>
                  <td className="px-5 py-3">{candidate.attempts}</td>
                  <td className="max-w-sm px-5 py-3 text-xs text-red-600">
                    <span className="flex items-start gap-1">
                      <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {candidate.failureReason ?? 'Alasan tidak dicatat.'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-[var(--color-content-muted)]">
                    {formatDateTimeId(candidate.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {failed.data ? (
        <AdminPagination
          page={failed.data.failed.page}
          pageSize={failed.data.failed.pageSize}
          total={failed.data.failed.total}
          onChange={setPage}
        />
      ) : null}
    </AdminPanel>
  );
}
