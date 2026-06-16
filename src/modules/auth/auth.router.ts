import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authService } from './auth.service';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendCreated, sendBadRequest } from '../../utils/response';

const router = Router();

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { sendBadRequest(res, 'Validation failed', errors.array()); return; }
  next();
};

// POST /auth/register
router.post('/register',
  [body('email').isEmail().normalizeEmail(),
   body('password').isLength({ min: 8 }),
   body('name').trim().isLength({ min: 2 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendCreated(res, await authService.register(req.body), 'Account created'); }
    catch (err) { next(err); }
  }
);

// POST /auth/login
router.post('/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendSuccess(res, await authService.login(req.body), 'Login successful'); }
    catch (err) { next(err); }
  }
);

// POST /auth/refresh
router.post('/refresh',
  [body('refreshToken').notEmpty()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendSuccess(res, await authService.refresh(req.body.refreshToken), 'Tokens refreshed'); }
    catch (err) { next(err); }
  }
);

// POST /auth/logout
router.post('/logout', authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body.refreshToken) await authService.logout(req.body.refreshToken);
      sendSuccess(res, null, 'Logged out');
    } catch (err) { next(err); }
  }
);

// POST /auth/onboarding
router.post('/onboarding', authenticate,
  [body('goalType').isIn(['LOSE_WEIGHT', 'MAINTAIN_WEIGHT', 'GAIN_MUSCLE']),
   body('currentWeight').isFloat({ min: 20, max: 500 }),
   body('targetWeight').isFloat({ min: 20, max: 500 }),
   body('activityLevel').isIn(['SEDENTARY', 'LIGHT', 'MODERATE', 'VERY_ACTIVE']),
   body('dietType').isIn(['STANDARD', 'VEGETARIAN', 'VEGAN', 'KETO', 'PALEO', 'MEDITERRANEAN']),
   body('mealsPerDay').isInt({ min: 2, max: 6 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await authService.completeOnboarding(req.user!.userId, req.body);
      sendSuccess(res, profile, 'Onboarding complete — your plan is ready!');
    } catch (err) { next(err); }
  }
);

// GET /auth/me
router.get('/me', authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendSuccess(res, await authService.getMe(req.user!.userId)); }
    catch (err) { next(err); }
  }
);

export default router;
