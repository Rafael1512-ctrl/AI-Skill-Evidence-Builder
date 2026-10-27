import { Router } from 'express';

import { adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { creditRouter } from './credit.routes.js';
import { cvRouter } from './cv.routes.js';
import { healthRouter } from './health.routes.js';
import { paymentRouter } from './payment.routes.js';
import { profileRouter } from './profile.routes.js';
import { screeningRouter } from './screening.routes.js';
import { testimonialRouter } from './testimonial.routes.js';

/**
 * The public API surface.
 *
 * Feature routers are mounted here as they land:
 *   /api/integrations, /api/testimonials and /api/admin are added by their own
 *   phases.
 * Nothing outside this module may mount routes.
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/cv', cvRouter);
apiRouter.use('/credits', creditRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/screening', screeningRouter);
apiRouter.use('/testimonials', testimonialRouter);
apiRouter.use('/admin', adminRouter);
