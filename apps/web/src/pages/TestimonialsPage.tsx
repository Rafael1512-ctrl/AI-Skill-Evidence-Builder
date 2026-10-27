import { useState } from 'react';
import { Link } from 'react-router-dom';

import { formatDateTimeId } from '@aseb/shared';

import {
  useMyTestimonialsQuery,
  usePublicTestimonialsQuery,
  useSubmitTestimonialMutation,
} from '../lib/testimonials.js';

/** Five stars, filled to `rating`; the number is also exposed to screen readers. */
export function RatingStars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} dari 5`} className="text-sm">
      <span aria-hidden="true">{'★'.repeat(rating)}</span>
      <span aria-hidden="true" className="text-[var(--color-content-muted)]">
        {'☆'.repeat(Math.max(0, 5 - rating))}
      </span>
    </span>
  );
}

/**
 * Review form.
 *
 * Rendered next to a finished enhancement so the testimonial is tied to real usage. The API
 * keeps it private until an admin approves it, and the copy says so.
 */
export function TestimonialForm({ enhancementId }: { enhancementId: string }) {
  const submit = useSubmitTestimonialMutation();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (submit.isSuccess) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 text-sm">
        Terima kasih! Testimoni Anda menunggu moderasi sebelum tampil publik.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (comment.trim().length < 10) {
          setError('Tulis testimoni minimal 10 karakter.');
          return;
        }
        submit.mutate(
          {
            rating,
            comment: comment.trim(),
            enhancementId,
            ...(displayName.trim().length > 0 ? { displayName: displayName.trim() } : {}),
          },
          { onError: (mutationError) => setError(mutationError.message) },
        );
      }}
    >
      <h2 className="font-medium">Beri testimoni</h2>
      <p className="text-xs text-[var(--color-content-muted)]">
        Testimoni tampil publik hanya setelah ditinjau admin. Nama tampilan tidak pernah diambil
        dari email akun Anda.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Penilaian</span>
        <select
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1"
          value={rating}
          onChange={(event) => setRating(Number(event.target.value))}
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} dari 5
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Testimoni</span>
        <textarea
          className="min-h-20 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Apa yang membantu dari hasil peningkatan CV ini?"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Nama tampilan (opsional)</span>
        <input
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-brand)]"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Nama yang Anda ingin tampilkan"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submit.isPending}
        className="self-start rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submit.isPending ? 'Mengirim…' : 'Kirim testimoni'}
      </button>
    </form>
  );
}

export function TestimonialsPage() {
  const testimonials = usePublicTestimonialsQuery();
  const mine = useMyTestimonialsQuery();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Testimoni pengguna</h1>
        <p className="text-sm text-[var(--color-content-muted)]">
          Ditulis oleh pengguna dan ditinjau admin sebelum tampil. Kami tidak menampilkan nama atau
          email akun tanpa izin.
        </p>
      </header>

      {testimonials.isPending ? <p className="text-sm">Memuat…</p> : null}
      {testimonials.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {(testimonials.error as Error).message}
        </p>
      ) : null}
      {testimonials.data && testimonials.data.testimonials.items.length === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">
          Belum ada testimoni yang tayang.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {testimonials.data?.testimonials.items.map((testimonial) => (
          <li
            key={testimonial.id}
            className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{testimonial.displayName}</span>
              <RatingStars rating={testimonial.rating} />
            </div>
            <p className="mt-2 text-sm">{testimonial.comment}</p>
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
              {formatDateTimeId(testimonial.createdAt)}
            </p>
          </li>
        ))}
      </ul>

      {mine.data && mine.data.testimonials.total > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Testimoni saya</h2>
          <ul className="text-sm text-[var(--color-content-muted)]">
            {mine.data.testimonials.items.map((testimonial) => (
              <li key={testimonial.id}>
                {testimonial.status === 'APPROVED'
                  ? 'Tayang'
                  : testimonial.status === 'PENDING'
                    ? 'Menunggu moderasi'
                    : 'Tidak ditayangkan'}{' '}
                · {testimonial.comment.slice(0, 60)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link to="/" className="text-sm font-medium text-[var(--color-brand)]">
        ← Kembali ke beranda
      </Link>
    </main>
  );
}
