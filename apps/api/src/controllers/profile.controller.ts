import type { Request, Response } from 'express';

import type { ProfileUpdateInput } from '@aseb/shared';

import { currentAuth } from '../middleware/auth.js';
import { validatedBody } from '../middleware/validate.js';
import { profileService } from '../services/profile.service.js';

/** GET /api/profile */
export async function getProfile(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const data = await profileService.get(auth.userId);
  res.json({ data });
}

/** PATCH /api/profile - partial update; `null` clears an optional field. */
export async function updateProfile(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const body = validatedBody<ProfileUpdateInput>(req);
  const profile = await profileService.update(auth.userId, body);
  res.json({ data: { profile } });
}

/** POST /api/profile/google/connect - capability check before the browser flow. */
export async function connectGoogle(req: Request, res: Response): Promise<void> {
  const auth = currentAuth(req);
  const googleLink = await profileService.beginGoogleConnect(auth.userId);
  res.json({ data: { googleLink } });
}
