import { Router } from 'express';
import { profileUpdateSchema } from '@aseb/shared';

import { connectGoogle, getProfile, updateProfile } from '../controllers/profile.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

export const profileRouter = Router();

profileRouter.get('/', requireAuth(), getProfile);

profileRouter.patch('/', requireAuth(), validate({ body: profileUpdateSchema }), updateProfile);

// Starts an OAuth flow on the provider side, so it is rate limited like a credential route.
profileRouter.post(
  '/google/connect',
  requireAuth(),
  rateLimit({ scope: 'profile-google-connect', windowMs: 60_000, max: 10 }),
  connectGoogle,
);
