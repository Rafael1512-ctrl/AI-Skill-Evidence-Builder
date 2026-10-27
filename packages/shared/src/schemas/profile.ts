import { z } from 'zod';

import { USER_ROLES } from '../constants/roles.js';
import { optionalUrlSchema, urlSchema } from './common.js';

/**
 * A PATCH field where an absent value means "leave unchanged" and `null` or an empty
 * string means "clear it". A form input that the user empties must be able to remove
 * a stored value, which is why this is not `optionalUrlSchema`.
 */
function clearableText(maxLength: number) {
  return z
    .union([z.string().trim().max(maxLength), z.null()])
    .transform((value) => (value === null || value === '' ? null : value))
    .optional();
}

const clearableUrl = z
  .union([urlSchema, z.literal(''), z.null()])
  .transform((value) => (value === '' || value === null ? null : value))
  .optional();

/**
 * PATCH /api/profile.
 *
 * Strict: only the fields a job seeker owns can be updated through this route. Email,
 * role, wallet and recruiter preferences are separate resources with their own rules,
 * so an attempt to send them is rejected rather than silently ignored.
 */
export const profileUpdateSchema = z
  .object({
    fullName: clearableText(200),
    headline: clearableText(160),
    phone: clearableText(32),
    location: clearableText(120),
    linkedinUrl: clearableUrl,
    githubUrl: clearableUrl,
    portfolioUrl: clearableUrl,
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const integrationLinkSchema = z.object({
  githubUrl: optionalUrlSchema,
  linkedinUrl: optionalUrlSchema,
  portfolioUrl: optionalUrlSchema,
});

export type IntegrationLinkInput = z.infer<typeof integrationLinkSchema>;

/** The user's own profile as returned by `GET /api/profile` - never credentials. */
export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(USER_ROLES),
  fullName: z.string().nullable(),
  headline: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  githubUsername: z.string().nullable(),
  hasPassword: z.boolean(),
  googleConnected: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

/** How a browser can attach a Google identity to an existing account. */
export const GOOGLE_LINK_METHODS = ['SUPABASE_LINK_IDENTITY'] as const;

export type GoogleLinkMethod = (typeof GOOGLE_LINK_METHODS)[number];

/**
 * Whether Google account linking is currently possible for this user.
 *
 * Supabase only supports attaching a provider to an *existing* user from the browser
 * SDK (`supabase.auth.linkIdentity`), so the API reports capability and the redirect
 * target; the client performs the OAuth exchange. The API decides, the client obeys.
 */
export const googleLinkStateSchema = z.object({
  supported: z.boolean(),
  /** User-facing reason when `supported` is false. */
  reason: z.string().nullable(),
  method: z.enum(GOOGLE_LINK_METHODS).nullable(),
  redirectTo: urlSchema.nullable(),
});

export type GoogleLinkState = z.infer<typeof googleLinkStateSchema>;

/** `GET /api/profile` */
export const profileResponseSchema = z.object({
  profile: userProfileSchema,
  googleLink: googleLinkStateSchema,
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** `PATCH /api/profile` */
export const profileUpdateResponseSchema = z.object({
  profile: userProfileSchema,
});

export type ProfileUpdateResponse = z.infer<typeof profileUpdateResponseSchema>;

/** `POST /api/profile/google/connect` */
export const googleConnectResponseSchema = z.object({
  googleLink: googleLinkStateSchema,
});

export type GoogleConnectResponse = z.infer<typeof googleConnectResponseSchema>;
