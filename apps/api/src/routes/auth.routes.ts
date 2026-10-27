import { Router } from 'express';
import { signInSchema, signUpSchema } from '@aseb/shared';

import { devSignIn, devSignUp, getMe } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

export const authRouter = Router();

// Development-only credential endpoints. In production the client talks to Supabase
// Auth directly and these return 403.
authRouter.post(
  '/dev/sign-up',
  rateLimit({ scope: 'auth-sign-up', windowMs: 60_000, max: 10 }),
  validate({ body: signUpSchema }),
  devSignUp,
);

authRouter.post(
  '/dev/sign-in',
  rateLimit({ scope: 'auth-sign-in', windowMs: 60_000, max: 20 }),
  validate({ body: signInSchema }),
  devSignIn,
);

authRouter.get('/me', requireAuth(), getMe);
