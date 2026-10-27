import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { publicTestimonialListSchema, testimonialSchema } from '@aseb/shared';

import { resetRateLimits } from '../src/middleware/rate-limit.js';
import { bearer, signUpDevUser, type DevSession } from './helpers/auth.js';
import { stopTestDatabase, useTestDatabase } from './helpers/db.js';

/**
 * Testimonials end to end against PGlite.
 *
 * The product promise under test: a review is private until an admin approves it, the public
 * list can never leak a pending or rejected one, moderation is server-enforced, and the
 * display name never falls back to the account email.
 */

describe('testimonials API', () => {
  let ctx: Awaited<ReturnType<typeof useTestDatabase>>;
  let app: Express;
  let session: DevSession;

  beforeAll(async () => {
    ctx = await useTestDatabase();
    ({ app } = await import('../src/server.test-helper.js'));
  });

  afterAll(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await ctx.db.reset();
    resetRateLimits();
    session = await signUpDevUser(app);
  });

  async function makeAdmin(target: DevSession = session): Promise<DevSession> {
    await ctx.prisma.user.update({ where: { id: target.userId }, data: { role: 'ADMIN' } });
    return { ...target, role: 'ADMIN' };
  }

  function submit(body: object, target: DevSession = session) {
    return request(app).post('/api/testimonials').set(bearer(target)).send(body);
  }

  function publicList() {
    return request(app).get('/api/testimonials?page=1&pageSize=10');
  }

  function moderate(testimonialId: string, status: string, target: DevSession = session) {
    return request(app)
      .patch(`/api/testimonials/${testimonialId}/moderation`)
      .set(bearer(target))
      .send({ status });
  }

  it('requires a session to submit and keeps a review private until approved', async () => {
    expect(
      (await request(app).post('/api/testimonials').send({ rating: 5, comment: 'Bagus sekali!' }))
        .status,
    ).toBe(401);

    const created = await submit({ rating: 5, comment: 'Membantu sekali menyusun ulang CV.' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(testimonialSchema.safeParse(created.body.data.testimonial).success).toBe(true);
    expect(created.body.data.testimonial).toMatchObject({ status: 'PENDING', rating: 5 });
    // The fallback is the profile name, never the account email.
    expect(created.body.data.testimonial.displayName).toBe('Pengguna Uji');
    expect(created.body.data.testimonial.displayName).not.toContain('@');

    const before = await publicList();
    expect(before.status).toBe(200);
    expect(publicTestimonialListSchema.safeParse(before.body.data.testimonials).success).toBe(true);
    expect(before.body.data.testimonials.total).toBe(0);

    // The author can see their own review and its status while it waits.
    const mine = await request(app).get('/api/testimonials/mine').set(bearer(session));
    expect(mine.body.data.testimonials.items[0]).toMatchObject({ status: 'PENDING' });
  });

  it('publishes an approved review and hides a rejected one', async () => {
    const first = await submit({ rating: 5, comment: 'Alur auditnya jelas dan cepat.' });
    const second = await submit({ rating: 2, comment: 'Masih ada bagian yang membingungkan.' });
    const admin = await makeAdmin();

    const approved = await moderate(first.body.data.testimonial.id, 'APPROVED', admin);
    expect(approved.status).toBe(200);
    expect(approved.body.data.testimonial.status).toBe('APPROVED');
    expect(approved.body.data.testimonial.moderatedAt).not.toBeNull();

    const rejected = await moderate(second.body.data.testimonial.id, 'REJECTED', admin);
    expect(rejected.body.data.testimonial.status).toBe('REJECTED');

    const published = await publicList();
    expect(published.body.data.testimonials.total).toBe(1);
    const [item] = published.body.data.testimonials.items;
    expect(item).toMatchObject({ rating: 5, comment: 'Alur auditnya jelas dan cepat.' });
    // The public shape never exposes the moderation status.
    expect(item).not.toHaveProperty('status');
  });

  it('enforces moderation server-side', async () => {
    const created = await submit({ rating: 4, comment: 'Ringkas dan mudah dipahami.' });
    const id = created.body.data.testimonial.id as string;

    expect(
      (await request(app).patch(`/api/testimonials/${id}/moderation`).send({ status: 'APPROVED' }))
        .status,
    ).toBe(401);
    expect((await moderate(id, 'APPROVED')).status).toBe(403);

    const queue = await request(app).get('/api/testimonials/moderation').set(bearer(session));
    expect(queue.status).toBe(403);

    const admin = await makeAdmin();
    const adminQueue = await request(app)
      .get('/api/testimonials/moderation?status=PENDING')
      .set(bearer(admin));
    expect(adminQueue.status).toBe(200);
    expect(adminQueue.body.data.testimonials.total).toBe(1);
  });

  it('validates the payload and refuses an unknown moderation status', async () => {
    expect((await submit({ rating: 6, comment: 'Terlalu tinggi nilainya.' })).status).toBe(400);
    expect((await submit({ rating: 4, comment: 'pendek' })).status).toBe(400);

    const created = await submit({ rating: 4, comment: 'Cukup membantu proses saya.' });
    const admin = await makeAdmin();
    expect((await moderate(created.body.data.testimonial.id, 'SHADOW_BANNED', admin)).status).toBe(
      400,
    );
  });

  it('ties a review to a completed enhancement and refuses duplicates or other users', async () => {
    const completed = await ctx.prisma.cvEnhancement.create({
      data: {
        userId: session.userId,
        status: 'COMPLETED',
        options: {},
        templateKey: 'ATS_MINIMAL',
      },
    });
    const pending = await ctx.prisma.cvEnhancement.create({
      data: { userId: session.userId, status: 'PENDING', options: {}, templateKey: 'ATS_MINIMAL' },
    });
    const other = await signUpDevUser(app);
    const foreign = await ctx.prisma.cvEnhancement.create({
      data: { userId: other.userId, status: 'COMPLETED', options: {}, templateKey: 'ATS_MINIMAL' },
    });

    const created = await submit({
      rating: 5,
      comment: 'Hasilnya sesuai CV saya tanpa tambahan aneh.',
      enhancementId: completed.id,
      displayName: 'Siti R.',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.testimonial.id).toBeTruthy();

    // The stored display name is what the author chose.
    const stored = await ctx.prisma.testimonial.findUnique({
      where: { id: created.body.data.testimonial.id },
    });
    expect(stored?.displayName).toBe('Siti R.');
    expect(stored?.enhancementId).toBe(completed.id);

    // One review per enhancement, nothing unverifiable, nothing about someone else.
    expect(
      (
        await submit({
          rating: 5,
          comment: 'Ulasan kedua untuk hasil yang sama.',
          enhancementId: completed.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await submit({
          rating: 5,
          comment: 'Ulasan untuk hasil orang lain.',
          enhancementId: foreign.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await submit({
          rating: 5,
          comment: 'Ulasan untuk hasil yang belum selesai.',
          enhancementId: pending.id,
        })
      ).status,
    ).toBe(409);
  });
});
