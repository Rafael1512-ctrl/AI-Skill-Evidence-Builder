import type {
  CreateTestimonialInput,
  PublicTestimonial,
  PublicTestimonialList,
  Testimonial as TestimonialDto,
  TestimonialList,
  TestimonialModerationInput,
  TestimonialModerationQuery,
  TestimonialStatus,
} from '@aseb/shared';

import type { Testimonial } from '../generated/prisma/client.js';
import { CvRepository } from '../repositories/cv.repository.js';
import {
  TestimonialRepository,
  type TestimonialWithModerator,
} from '../repositories/testimonial.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/errors.js';

/** Used when the author leaves the display name blank; never the account email. */
const ANONYMOUS_DISPLAY_NAME = 'Pengguna AI Skill Evidence Builder';

/**
 * Testimonials (Phase 17).
 *
 * A review is submitted by its author and becomes public only after an admin approves it.
 * `displayName` is chosen by the author (falling back to their profile name), never derived
 * from the account email, and the link to a completed enhancement keeps the social proof
 * tied to real usage instead of anonymous praise.
 */
export class TestimonialService {
  constructor(
    private readonly repository = new TestimonialRepository(),
    private readonly cvRepository = new CvRepository(),
    private readonly users = new UserRepository(),
  ) {}

  private toDto(row: Testimonial): TestimonialDto {
    return {
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      displayName: row.displayName,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      moderatedAt: row.moderatedAt ? row.moderatedAt.toISOString() : null,
    };
  }

  private toPublicDto(row: Testimonial): PublicTestimonial {
    return {
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Submits a review for moderation.
   *
   * When an `enhancementId` is supplied it must belong to the caller and be finished: a review
   * of an enhancement that does not exist (or is not theirs) would be unverifiable social
   * proof. One review per enhancement, to keep the moderation queue honest.
   */
  async submit(input: { userId: string; body: CreateTestimonialInput }): Promise<TestimonialDto> {
    let enhancementId: string | null = null;

    if (input.body.enhancementId) {
      const enhancement = await this.cvRepository.findEnhancement(input.body.enhancementId);
      if (!enhancement || enhancement.userId !== input.userId) {
        throw AppError.notFound('Hasil peningkatan CV tidak ditemukan.');
      }
      if (enhancement.status !== 'COMPLETED') {
        throw AppError.conflict('Peningkatan CV ini belum selesai, jadi belum bisa diulas.');
      }

      const existing = await this.repository.findByEnhancement({
        userId: input.userId,
        enhancementId: enhancement.id,
      });
      if (existing) {
        throw AppError.conflict('Anda sudah mengirim testimoni untuk hasil ini.');
      }
      enhancementId = enhancement.id;
    }

    // The fallback is the profile name, never the account email.
    const author = await this.users.findById(input.userId);
    const displayName =
      input.body.displayName?.trim() || author?.fullName?.trim() || ANONYMOUS_DISPLAY_NAME;

    const created = await this.repository.create({
      userId: input.userId,
      rating: input.body.rating,
      comment: input.body.comment,
      displayName: displayName.slice(0, 80),
      enhancementId,
    });

    return this.toDto(created);
  }

  /** The public list: approved only. */
  async listPublic(input: { page: number; pageSize: number }): Promise<PublicTestimonialList> {
    const { items, total } = await this.repository.listApproved({
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    return {
      items: items.map((row) => this.toPublicDto(row)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  /** The author's own reviews, so the UI can show "menunggu moderasi". */
  async listMine(input: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<TestimonialList> {
    const { items, total } = await this.repository.listByUser({
      userId: input.userId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    return {
      items: items.map((row) => this.toDto(row)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  /** Admin-only moderation queue. */
  async listForModeration(query: TestimonialModerationQuery): Promise<TestimonialList> {
    const { items, total } = await this.repository.listForModeration({
      status: query.status,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((row) => this.toDto(row as TestimonialWithModerator)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Admin-only: approving makes a testimonial public, rejecting keeps it private. */
  async moderate(input: {
    testimonialId: string;
    moderatorId: string;
    body: TestimonialModerationInput;
  }): Promise<TestimonialDto> {
    const existing = await this.repository.findById(input.testimonialId);
    if (!existing) throw AppError.notFound('Testimoni tidak ditemukan.');

    const status: TestimonialStatus = input.body.status;
    const updated = await this.repository.moderate({
      id: existing.id,
      status,
      moderatedByUserId: input.moderatorId,
    });

    return this.toDto(updated);
  }
}

export const testimonialService = new TestimonialService();
