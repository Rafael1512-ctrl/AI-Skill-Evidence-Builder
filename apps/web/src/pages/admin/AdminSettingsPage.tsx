import { useState } from 'react';

import { formatDateTimeId } from '@aseb/shared';

import {
  useAdminOverviewQuery,
  useAdminTestimonialsQuery,
  useModerateTestimonialMutation,
  useUpdateFeaturePricingMutation,
} from '../../lib/admin.js';
import { RatingStars } from '../TestimonialsPage.js';
import { AdminEmpty, AdminError, AdminPageHeader, AdminPanel } from './AdminUi.js';

export function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        eyebrow="Platform controls"
        title="Harga dan moderasi"
        description="Harga fitur memakai override terpusat; testimoni baru tampil setelah disetujui admin."
      />
      <PricingEditor />
      <ModerationQueue />
    </div>
  );
}

function PricingEditor() {
  const overview = useAdminOverviewQuery();
  const update = useUpdateFeaturePricingMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <AdminPanel
      title="Harga kredit"
      description="Perubahan disimpan sebagai override dan langsung dipakai layanan kredit. Default tetap berasal dari paket bersama."
    >
      {notice ? <p className="px-5 pt-4 text-sm">{notice}</p> : null}
      {overview.isPending ? <p className="px-5 py-8 text-sm">Memuat harga…</p> : null}
      {overview.isError ? (
        <div className="p-4">
          <AdminError error={overview.error} />
        </div>
      ) : null}
      {overview.data?.pricing.length === 0 ? <AdminEmpty>Tidak ada harga fitur.</AdminEmpty> : null}
      <ul className="divide-y divide-[var(--color-border-subtle)]">
        {overview.data?.pricing.map((item) => (
          <li
            key={item.feature}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-xs text-[var(--color-content-muted)]">
                {item.feature}
                {item.isOverride
                  ? ` · override (diubah ${item.updatedAt ? formatDateTimeId(item.updatedAt) : '-'})`
                  : ' · default'}
              </span>
              <span className="mt-1 max-w-xl text-xs text-[var(--color-content-muted)]">
                {item.description}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <input
                aria-label={`Kredit ${item.feature}`}
                className="w-20 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-sm"
                value={drafts[item.feature] ?? String(item.credits)}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [item.feature]: event.target.value }))
                }
              />
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                disabled={update.isPending}
                onClick={() => {
                  const credits = Number(drafts[item.feature] ?? item.credits);
                  setNotice(null);
                  update.mutate(
                    { feature: item.feature, credits },
                    {
                      onSuccess: (updated) =>
                        setNotice(`${updated.label} sekarang ${updated.credits} kredit.`),
                      onError: (error) => setNotice(error.message),
                    },
                  );
                }}
              >
                Simpan
              </button>
            </span>
          </li>
        ))}
      </ul>
    </AdminPanel>
  );
}

function ModerationQueue() {
  const queue = useAdminTestimonialsQuery('PENDING');
  const moderate = useModerateTestimonialMutation();

  return (
    <AdminPanel title="Moderasi testimoni" description="Review tetap privat sampai disetujui.">
      {queue.isPending ? <p className="px-5 py-8 text-sm">Memuat testimoni…</p> : null}
      {queue.isError ? (
        <div className="p-4">
          <AdminError error={queue.error} />
        </div>
      ) : null}
      {queue.data && queue.data.testimonials.items.length === 0 ? (
        <AdminEmpty>Tidak ada testimoni menunggu.</AdminEmpty>
      ) : null}
      <ul className="divide-y divide-[var(--color-border-subtle)]">
        {queue.data?.testimonials.items.map((testimonial) => (
          <li key={testimonial.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{testimonial.displayName}</span>
              <RatingStars rating={testimonial.rating} />
            </div>
            <p className="mt-2 text-sm">{testimonial.comment}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                disabled={moderate.isPending}
                onClick={() => moderate.mutate({ id: testimonial.id, status: 'APPROVED' })}
              >
                Setujui
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                disabled={moderate.isPending}
                onClick={() => moderate.mutate({ id: testimonial.id, status: 'REJECTED' })}
              >
                Tolak
              </button>
            </div>
          </li>
        ))}
      </ul>
    </AdminPanel>
  );
}
