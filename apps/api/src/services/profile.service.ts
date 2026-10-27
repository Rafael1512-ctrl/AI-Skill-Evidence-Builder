import type { GoogleLinkState, ProfileUpdateInput, UserProfile } from '@aseb/shared';

import { env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { UserRepository, type UserProfileUpdate } from '../repositories/user.repository.js';
import { AppError } from '../utils/errors.js';

/** Maps a user row to the safe, user-facing profile shape (never credentials). */
export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    fullName: user.fullName,
    headline: user.headline,
    phone: user.phone,
    location: user.location,
    avatarUrl: user.avatarUrl,
    linkedinUrl: user.linkedinUrl,
    githubUrl: user.githubUrl,
    portfolioUrl: user.portfolioUrl,
    githubUsername: user.githubUsername,
    hasPassword: user.hasPassword,
    googleConnected: user.googleConnected,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * Self-service profile management.
 *
 * Deliberately narrow: only the fields in `profileUpdateSchema` can change here. Email,
 * role, credits and recruiter preferences are owned by their own services and can never
 * be altered through this route.
 */
export class ProfileService {
  constructor(private readonly users = new UserRepository()) {}

  async get(userId: string): Promise<{ profile: UserProfile; googleLink: GoogleLinkState }> {
    const user = await this.requireUser(userId);
    return { profile: toUserProfile(user), googleLink: this.googleLinkState(user) };
  }

  async update(userId: string, input: ProfileUpdateInput): Promise<UserProfile> {
    const changes: UserProfileUpdate = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        changes[key as keyof UserProfileUpdate] = value as string | null;
      }
    }

    if (Object.keys(changes).length === 0) {
      throw AppError.validation([], 'Tidak ada perubahan yang dikirim.');
    }

    const user = await this.users.updateProfile(userId, changes);
    return toUserProfile(user);
  }

  /**
   * Google linking capability for this account.
   *
   * Supabase attaches a provider to an existing user only from the browser SDK, so the
   * API's job is to decide whether linking is allowed and where the client should
   * return afterwards. The client never gets to choose the redirect target.
   */
  googleLinkState(user: User): GoogleLinkState {
    if (user.googleConnected) {
      return {
        supported: false,
        reason: 'Akun Google sudah terhubung ke akun ini.',
        method: null,
        redirectTo: null,
      };
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return {
        supported: false,
        reason:
          'Menghubungkan Google memerlukan konfigurasi Supabase (SUPABASE_URL dan SUPABASE_ANON_KEY).',
        method: null,
        redirectTo: null,
      };
    }

    return {
      supported: true,
      reason: null,
      method: 'SUPABASE_LINK_IDENTITY',
      redirectTo: `${env.FRONTEND_URL.replace(/\/$/, '')}/profile`,
    };
  }

  /** Preflight for the client before it starts the Supabase linking flow. */
  async beginGoogleConnect(userId: string): Promise<GoogleLinkState> {
    const user = await this.requireUser(userId);
    const state = this.googleLinkState(user);

    if (state.supported) return state;
    if (user.googleConnected) {
      throw AppError.conflict(state.reason ?? 'Akun Google sudah terhubung.');
    }
    throw AppError.upstream(state.reason ?? 'Menghubungkan Google tidak tersedia saat ini.');
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.authenticationRequired('Akun tidak ditemukan.');
    return user;
  }
}

export const profileService = new ProfileService();
