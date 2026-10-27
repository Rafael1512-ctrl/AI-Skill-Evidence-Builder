import { z } from 'zod';

import { USER_ROLES } from '../constants/roles.js';
import { emailSchema, shortTextSchema } from './common.js';

/**
 * Supabase performs the actual credential work. These schemas exist because the
 * API also exposes a local development strategy (`AUTH_DEV_MODE`) and because the
 * UI validates input before submitting.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Kata sandi minimal 8 karakter')
  .max(72, 'Kata sandi maksimal 72 karakter');

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: shortTextSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const devSignInSchema = signInSchema;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().nullable().optional(),
});

export type AuthSession = z.infer<typeof authSessionSchema>;

/** The signed-in user as the API reports them - never credentials. */
export const authenticatedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  hasPassword: z.boolean(),
  googleConnected: z.boolean(),
  createdAt: z.string(),
});

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/** Response of the development sign-in/sign-up endpoints. */
export const devAuthResponseSchema = z.object({
  accessToken: z.string(),
  user: authenticatedUserSchema,
});

export type DevAuthResponse = z.infer<typeof devAuthResponseSchema>;
