import type { Testimonial, TestimonialStatus, User } from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';

export type TestimonialWithModerator = Testimonial & { moderatedByUser: User | null };

/**
 * Testimonial persistence.
 *
 * Moderation is a state change with an audit trail (`moderatedByUserId`, `moderatedAt`), and
 * the public read is filtered by `APPROVED` in SQL rather than in the service, so a
 * rejected testimonial can never leak through a forgotten filter.
 */
export class TestimonialRepository {
  async create(input: {
    userId: string;
    rating: number;
    comment: string;
    displayName: string;
    enhancementId: string | null;
  }): Promise<Testimonial> {
    return getPrisma().testimonial.create({
      data: {
        userId: input.userId,
        rating: input.rating,
        comment: input.comment,
        displayName: input.displayName,
        enhancementId: input.enhancementId,
        status: 'PENDING',
      },
    });
  }

  async findById(id: string): Promise<Testimonial | null> {
    return getPrisma().testimonial.findUnique({ where: { id } });
  }

  /**
   * An existing testimonial for the same enhancement.
   *
   * Used to refuse a second review of the same enhancement rather than letting one user fill
   * the moderation queue with duplicates.
   */
  async findByEnhancement(input: {
    userId: string;
    enhancementId: string;
  }): Promise<Testimonial | null> {
    return getPrisma().testimonial.findFirst({
      where: { userId: input.userId, enhancementId: input.enhancementId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Public list: approved only, newest first. */
  async listApproved(input: { skip: number; take: number }): Promise<{
    items: Testimonial[];
    total: number;
  }> {
    const where = { status: 'APPROVED' as TestimonialStatus };
    const [items, total] = await Promise.all([
      getPrisma().testimonial.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().testimonial.count({ where }),
    ]);
    return { items, total };
  }

  async listByUser(input: { userId: string; skip: number; take: number }): Promise<{
    items: Testimonial[];
    total: number;
  }> {
    const where = { userId: input.userId };
    const [items, total] = await Promise.all([
      getPrisma().testimonial.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().testimonial.count({ where }),
    ]);
    return { items, total };
  }

  /** Moderation queue: every status, optionally filtered, oldest first so nothing starves. */
  async listForModeration(input: {
    status?: TestimonialStatus | undefined;
    skip: number;
    take: number;
  }): Promise<{ items: TestimonialWithModerator[]; total: number }> {
    const where = input.status ? { status: input.status } : {};
    const [items, total] = await Promise.all([
      getPrisma().testimonial.findMany({
        where,
        include: { moderatedByUser: true },
        orderBy: { createdAt: 'asc' },
        skip: input.skip,
        take: input.take,
      }),
      getPrisma().testimonial.count({ where }),
    ]);
    return { items, total };
  }

  async moderate(input: {
    id: string;
    status: TestimonialStatus;
    moderatedByUserId: string;
  }): Promise<Testimonial> {
    return getPrisma().testimonial.update({
      where: { id: input.id },
      data: {
        status: input.status,
        moderatedByUserId: input.moderatedByUserId,
        moderatedAt: new Date(),
      },
    });
  }
}

export const testimonialRepository = new TestimonialRepository();
