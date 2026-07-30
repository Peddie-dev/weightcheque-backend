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
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendCreated(res, await authService.register(req.body), 'Account created'); }
    catch (err) { next(err); }
  }
);

// POST /auth/login
router.post('/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendSuccess(res, await authService.login(req.body), 'Login successful'); }
    catch (err) { next(err); }
  }
);

// POST /auth/refresh
router.post('/refresh',
  [body('refreshToken').notEmpty()],
  validate,
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

// POST /auth/forgot-password
router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.forgotPassword(req.body.email);
      sendSuccess(res, result, result.message);
    } catch (err) { next(err); }
  }
);

// POST /auth/verify-otp
router.post('/verify-otp',
  [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.verifyOtp(req.body.email, req.body.otp);
      sendSuccess(res, result, 'Code verified');
    } catch (err) { next(err); }
  }
);

// POST /auth/reset-password
router.post('/reset-password',
  [
    body('email').isEmail().normalizeEmail(),
    body('resetToken').notEmpty(),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.resetPassword(
        req.body.email,
        req.body.resetToken,
        req.body.newPassword,
      );
      sendSuccess(res, result, result.message);
    } catch (err) { next(err); }
  }
);

// POST /auth/onboarding
router.post('/onboarding', authenticate,
  [
    body('goalType').isIn(['LOSE_WEIGHT', 'MAINTAIN_WEIGHT', 'GAIN_MUSCLE', 'IMPROVE_HEALTH']),
    body('currentWeight').isFloat({ min: 20, max: 500 }),
    body('targetWeight').isFloat({ min: 20, max: 500 }),
    body('activityLevel').isIn(['SEDENTARY', 'LIGHT', 'MODERATE', 'VERY_ACTIVE']),
    body('dietType').isIn(['STANDARD', 'VEGETARIAN', 'VEGAN', 'KETO', 'PALEO', 'MEDITERRANEAN']),
    body('mealsPerDay').isInt({ min: 2, max: 6 }),
    body('firstName').optional().trim().isLength({ min: 1, max: 100 }),
    body('lastName').optional().trim().isLength({ min: 1, max: 100 }),
    body('gender').optional().isIn(['male', 'female', 'other']),
    body('dateOfBirth').optional().isString(),
    body('height').optional().isFloat({ min: 50, max: 300 }),
    body('waistCircumference').optional().isFloat({ min: 30, max: 300 }),
    body('medicalConditions').optional().isArray(),
    body('medications').optional().isString().isLength({ max: 500 }),
    body('sleepHours').optional().isString(),
    body('focusTime').optional().isIn(['morning', 'afternoon', 'evening']),
    body('foodTriggers').optional().isString().isLength({ max: 500 }),
  ],
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