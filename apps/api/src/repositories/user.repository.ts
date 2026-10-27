import type { Prisma, User } from '../generated/prisma/client.js';
import { getPrisma } from '../db/prisma.js';

export interface UpsertUserInput {
  email: string;
  provider: 'PASSWORD' | 'GOOGLE';
  providerUserId: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
}

export interface ListUsersInput {
  skip: number;
  take: number;
  search?: string;
  role?: 'USER' | 'ADMIN';
}

/**
 * Fields a user may change about themselves. `null` clears a value; an absent key
 * leaves it untouched - the same convention the PATCH contract uses.
 */
export interface UserProfileUpdate {
  fullName?: string | null;
  headline?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
}

export interface CreatePasswordUserInput {
  email: string;
  fullName: string;
  passwordHash: string;
  passwordSalt: string;
}

export interface PasswordIdentity {
  passwordHash: string | null;
  passwordSalt: string | null;
}

export interface AuthFlagState {
  emailVerified: boolean;
  googleConnected: boolean;
  hasPassword: boolean;
}

/**
 * Merges the flags a login may set with the ones the account already has.
 *
 * Flags are additive and only ever move in one direction: linking Google must survive a
 * later password sign-in, adding a password must survive a later Google sign-in, and a
 * verified email is never un-verified by a stale token. Removing a provider is an
 * explicit account operation, not something a login can do as a side effect.
 */
export function mergeAuthFlags(
  existing: AuthFlagState | null,
  input: { provider: 'PASSWORD' | 'GOOGLE' },
  emailVerified: boolean,
): AuthFlagState {
  return {
    emailVerified: emailVerified || existing?.emailVerified === true,
    googleConnected: input.provider === 'GOOGLE' || existing?.googleConnected === true,
    hasPassword: input.provider === 'PASSWORD' || existing?.hasPassword === true,
  };
}

/**
 * All user persistence lives here so services never touch Prisma directly.
 */
export class UserRepository {
  async findById(id: string): Promise<User | null> {
    return getPrisma().user.findUnique({ where: { id } });
  }

  async findByIdWithWallet(
    id: string,
  ): Promise<(User & { wallet: { balance: number; reserved: number } | null }) | null> {
    return getPrisma().user.findUnique({
      where: { id },
      include: { wallet: { select: { balance: true, reserved: true } } },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return getPrisma().user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async listConfirmedGoogleIdentity(userId: string): Promise<boolean> {
    const identity = await getPrisma().authIdentity.findFirst({
      where: { userId, provider: 'GOOGLE' },
      select: { id: true },
    });
    return identity !== null;
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return getPrisma().user.create({ data });
  }

  /**
   * Creates a local email/password account.
   *
   * The identity's `providerUserId` is the local user id - the same value the dev
   * token strategy puts in `sub` - so a later bearer request resolves the identity it
   * already has instead of creating a duplicate one.
   */
  async createPasswordUser(input: CreatePasswordUserInput): Promise<User> {
    const email = input.email.toLowerCase();
    return getPrisma().$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, fullName: input.fullName, emailVerified: true, hasPassword: true },
      });
      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: 'PASSWORD',
          providerUserId: user.id,
          email,
          passwordHash: input.passwordHash,
          passwordSalt: input.passwordSalt,
        },
      });
      return user;
    });
  }

  /** Credential material for the local strategy; never leaves the repository layer. */
  async findPasswordIdentity(userId: string): Promise<PasswordIdentity | null> {
    const identity = await getPrisma().authIdentity.findFirst({
      where: { userId, provider: 'PASSWORD' },
      select: { passwordHash: true, passwordSalt: true },
    });
    return identity ?? null;
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return getPrisma().user.update({ where: { id }, data });
  }

  /** Profile-only update: email, role and credentials are not reachable from here. */
  async updateProfile(id: string, data: UserProfileUpdate): Promise<User> {
    return getPrisma().user.update({ where: { id }, data });
  }

  async setRole(id: string, role: 'USER' | 'ADMIN'): Promise<User> {
    return getPrisma().user.update({ where: { id }, data: { role } });
  }

  async list(input: ListUsersInput): Promise<{ items: User[]; total: number }> {
    const where: Prisma.UserWhereInput = {};
    if (input.role) where.role = input.role;
    if (input.search) {
      where.OR = [
        { email: { contains: input.search, mode: 'insensitive' } },
        { fullName: { contains: input.search, mode: 'insensitive' } },
      ];
    }

    const prisma = getPrisma();
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: input.skip,
        take: input.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Creates or refreshes the user that belongs to an authentication identity.
   *
   * Google-authenticated accounts are considered verified, matching the product rules.
   * An existing local account with the same email is linked rather than duplicated.
   */
  async upsertFromAuth(input: UpsertUserInput): Promise<User> {
    const prisma = getPrisma();
    const email = input.email.toLowerCase();
    const emailVerified = input.emailVerified ?? input.provider === 'GOOGLE';

    return prisma.$transaction(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: input.provider,
            providerUserId: input.providerUserId,
          },
        },
        include: { user: true },
      });

      if (identity) {
        return tx.user.update({
          where: { id: identity.userId },
          data: {
            emailVerified: identity.user.emailVerified || emailVerified,
            googleConnected: identity.user.googleConnected || input.provider === 'GOOGLE',
            ...(input.fullName && !identity.user.fullName ? { fullName: input.fullName } : {}),
            ...(input.avatarUrl && !identity.user.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
          },
        });
      }

      // Read the row first so an existing account is never downgraded: signing in with
      // a password after linking Google must keep `googleConnected`, and a Google
      // sign-in must not clear `hasPassword`. The atomic upsert below still owns the
      // create path, so two concurrent first logins cannot duplicate the email.
      const existing = await tx.user.findUnique({ where: { email } });
      const flags = mergeAuthFlags(existing, input, emailVerified);
      const user = await tx.user.upsert({
        where: { email },
        update: flags,
        create: {
          email,
          fullName: input.fullName ?? null,
          avatarUrl: input.avatarUrl ?? null,
          ...flags,
        },
      });

      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: input.provider,
          providerUserId: input.providerUserId,
          email,
        },
      });

      return user;
    });
  }

  async countAll(): Promise<number> {
    return getPrisma().user.count();
  }

  async countAdmins(): Promise<number> {
    return getPrisma().user.count({ where: { role: 'ADMIN' } });
  }

  async countCreatedSince(date: Date): Promise<number> {
    return getPrisma().user.count({ where: { createdAt: { gte: date } } });
  }
}
