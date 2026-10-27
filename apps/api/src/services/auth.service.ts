import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { UserRole } from '@aseb/shared';

import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import {
  signDevToken,
  verifyDevToken,
  verifySupabaseToken,
  type VerifiedToken,
} from '../utils/jwt.js';
import { UserRepository } from '../repositories/user.repository.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  provider: 'PASSWORD' | 'GOOGLE' | 'DEV';
}

export interface SignUpResult {
  auth: AuthContext;
  accessToken: string;
}

/**
 * Authentication.
 *
 * Production uses Supabase Auth (email/password + Google OAuth) and verifies tokens
 * against the project JWKS. `AUTH_DEV_MODE=true` swaps in a local HS256 strategy so
 * contributors and tests can work entirely offline. All authorization decisions -
 * including the ADMIN role - are made here and in `requireAdmin`, never in the UI.
 */
export class AuthService {
  constructor(private readonly users = new UserRepository()) {}

  get isDevMode(): boolean {
    return env.AUTH_DEV_MODE && !env.isProduction;
  }

  /** Resolves a bearer token into an application user, creating the row on first sight. */
  async authenticateBearer(token: string): Promise<AuthContext> {
    const { verified, strategy } = await this.verifyToken(token);
    const email = verified.email ?? `${verified.subject}@unknown.local`;

    const user = await this.users.upsertFromAuth({
      email,
      provider: verified.provider,
      providerUserId: verified.subject,
      fullName: verified.fullName,
      avatarUrl: verified.avatarUrl,
      emailVerified: verified.emailVerified,
    });

    const role = await this.resolveRole(user.role, email);
    if (role !== user.role) {
      await this.users.setRole(user.id, role);
    }

    return {
      userId: user.id,
      email: user.email,
      role,
      emailVerified: user.emailVerified,
      // `DEV` marks the local strategy specifically. A Supabase email/password session is
      // also 'PASSWORD' upstream, so the strategy - not the provider claim - decides.
      provider: strategy === 'DEV' ? 'DEV' : verified.provider,
    };
  }

  private async verifyToken(
    token: string,
  ): Promise<{ verified: VerifiedToken; strategy: 'DEV' | 'SUPABASE' }> {
    // Offline development keeps the local HS256 strategy first so nothing about the
    // default setup changes. A token the local secret cannot verify now falls through
    // to Supabase JWKS when SUPABASE_URL is configured, which lets one API process
    // serve both strategies while a developer adopts real Supabase auth without first
    // flipping AUTH_DEV_MODE. Production is unaffected: `isDevMode` is always false
    // there, so only the Supabase branch is reachable.
    const devSecret = this.isDevMode ? env.AUTH_DEV_JWT_SECRET : undefined;
    if (devSecret) {
      try {
        return { verified: await verifyDevToken(token, devSecret), strategy: 'DEV' };
      } catch (error) {
        if (!env.SUPABASE_URL) throw error;
      }
    }
    if (env.SUPABASE_URL) {
      return {
        verified: await verifySupabaseToken(token, {
          url: env.SUPABASE_URL,
          audience: 'authenticated',
        }),
        strategy: 'SUPABASE',
      };
    }
    throw AppError.authenticationRequired(
      'Autentikasi belum dikonfigurasi: set SUPABASE_URL atau aktifkan AUTH_DEV_MODE untuk pengembangan.',
    );
  }

  /**
   * Bootstraps the ADMIN role from ADMIN_EMAILS. Existing roles in the database win,
   * so revoking admin access is done by editing the user, not the environment.
   */
  private async resolveRole(currentRole: UserRole, email: string): Promise<UserRole> {
    if (currentRole === 'ADMIN') return 'ADMIN';
    const bootstrapped = env.ADMIN_EMAILS.map((entry) => entry.toLowerCase());
    if (bootstrapped.includes(email.toLowerCase())) return 'ADMIN';
    return 'USER';
  }

  /* ------------------------------------------------------------------ */
  /* Development-only email + password flows                             */
  /* ------------------------------------------------------------------ */

  async devSignUp(input: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<SignUpResult> {
    this.assertDevMode();

    const existing = await this.users.findByEmail(input.email);
    if (existing) throw AppError.conflict('Email ini sudah terdaftar. Silakan masuk.');

    const salt = randomBytes(16).toString('hex');
    const hash = (await scryptAsync(input.password, salt, 64)).toString('hex');

    const user = await this.users.createPasswordUser({
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      passwordHash: hash,
      passwordSalt: salt,
    });

    const role = await this.resolveRole(user.role, user.email);
    if (role !== user.role) await this.users.setRole(user.id, role);

    const accessToken = await this.issueDevToken(user.id, user.email, user.fullName, role);
    return {
      auth: { userId: user.id, email: user.email, role, emailVerified: true, provider: 'DEV' },
      accessToken,
    };
  }

  async devSignIn(input: { email: string; password: string }): Promise<SignUpResult> {
    this.assertDevMode();

    const user = await this.users.findByEmail(input.email);
    if (!user) throw AppError.invalidCredentials();

    const identity = await this.users.findPasswordIdentity(user.id);

    if (!identity?.passwordHash || !identity.passwordSalt) {
      throw AppError.invalidCredentials();
    }

    const candidate = await scryptAsync(input.password, identity.passwordSalt, 64);
    const expected = Buffer.from(identity.passwordHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw AppError.invalidCredentials();
    }

    const role = await this.resolveRole(user.role, user.email);
    const accessToken = await this.issueDevToken(user.id, user.email, user.fullName, role);

    return {
      auth: {
        userId: user.id,
        email: user.email,
        role,
        emailVerified: user.emailVerified,
        provider: 'DEV',
      },
      accessToken,
    };
  }

  private async issueDevToken(
    userId: string,
    email: string,
    fullName: string | null,
    role: UserRole,
  ): Promise<string> {
    const secret = env.AUTH_DEV_JWT_SECRET;
    if (!secret) {
      throw AppError.internal(
        new Error('AUTH_DEV_JWT_SECRET is required when AUTH_DEV_MODE is enabled.'),
      );
    }
    return signDevToken({ subject: userId, email, fullName, role }, secret);
  }

  private assertDevMode(): void {
    if (!this.isDevMode) {
      throw AppError.forbidden(
        'Pendaftaran lokal tidak aktif. Gunakan Supabase Auth (email/password atau Google).',
      );
    }
  }
}

export const authService = new AuthService();
