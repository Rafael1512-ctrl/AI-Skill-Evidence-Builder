import type { Request, Response } from 'express';
import type { AuthenticatedUser, SignInInput, SignUpInput } from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody } from '../middleware/validate.js';
import { authService } from '../services/auth.service.js';
import { creditService } from '../services/credit.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/errors.js';

const users = new UserRepository();

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  fullName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  googleConnected: boolean;
  createdAt: Date;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerified,
    hasPassword: user.hasPassword,
    googleConnected: user.googleConnected,
    createdAt: user.createdAt.toISOString(),
  };
}

/** POST /api/auth/dev/sign-up - development only. */
export async function devSignUp(req: Request, res: Response): Promise<void> {
  const body = validatedBody<SignUpInput>(req);
  const result = await authService.devSignUp(body);
  await creditService.ensureWallet(result.auth.userId);

  const user = await users.findById(result.auth.userId);
  if (!user) throw AppError.internal(new Error('User disappeared right after sign-up'));

  res.status(201).json({
    data: { accessToken: result.accessToken, user: toAuthenticatedUser(user) },
  });
}

/** POST /api/auth/dev/sign-in - development only. */
export async function devSignIn(req: Request, res: Response): Promise<void> {
  const body = validatedBody<SignInInput>(req);
  const result = await authService.devSignIn(body);

  const user = await users.findById(result.auth.userId);
  if (!user) throw AppError.invalidCredentials();

  res.json({ data: { accessToken: result.accessToken, user: toAuthenticatedUser(user) } });
}

/** GET /api/auth/me */
export async function getMe(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const user = await users.findById(auth.userId);
  if (!user) throw AppError.authenticationRequired('Akun tidak ditemukan.');

  const wallet = await creditService.getWallet(auth.userId);

  res.json({
    data: {
      user: toAuthenticatedUser(user),
      wallet: { balance: wallet.balance, reserved: wallet.reserved, available: wallet.available },
      authStrategy: auth.provider,
    },
  });
}
