import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendCreated, sendBadRequest } from '../../utils/response';
import { notificationService } from './notification.service';
import { validationResult } from 'express-validator';

const router = Router();
router.use(authenticate);

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { sendBadRequest(res, 'Validation failed', errors.array()); return; }
  next();
};

// POST /notifications/token — register Expo push token
router.post('/token',
  [body('token').notEmpty(), body('platform').isIn(['ios', 'android'])],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationService.registerToken(req.user!.userId, req.body.token, req.body.platform);
      sendCreated(res, null, 'Push token registered');
    } catch (err) { next(err); }
  }
);

// DELETE /notifications/token — deactivate token (on logout)
router.delete('/token',
  [body('token').notEmpty()], validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationService.deactivateToken(req.body.token);
      sendSuccess(res, null, 'Token deactivated');
    } catch (err) { next(err); }
  }
);

// GET /notifications — history for current user
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt((req.query.limit as string) ?? '30');
    const items = await notificationService.getForUser(req.user!.userId, limit);
    const unreadCount = items.filter((n) => !n.readAt).length;
    sendSuccess(res, { items, unreadCount });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationService.markRead(req.params.id, req.user!.userId);
    sendSuccess(res, null, 'Marked as read');
  } catch (err) { next(err); }
});

// PATCH /notifications/read-all
router.patch('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../../config/prisma');
    await prisma.notification.updateMany({
      where: { userId: req.user!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) { next(err); }
});

export default router;
