import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import prisma from '../../config/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  sendSuccess, sendCreated, sendNotFound, sendBadRequest, sendError,
} from '../../utils/response';
import { AppError } from '../../middleware/errorHandler';
import { notificationService } from '../notifications/notification.service';
import { logger } from '../../config/logger';

const router = Router();

// All nutritionist routes require auth + NUTRITIONIST (or ADMIN) role
router.use(authenticate, requireRole('NUTRITIONIST', 'ADMIN'));

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { sendBadRequest(res, 'Validation failed', errors.array()); return; }
  next();
};

// ── GET /nutritionist/members ─────────────────────────────────────────────────
// List all members (premium first), with optional search + status filter

router.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, status, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = { role: 'USER' };
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.subscription = { status };

    const [members, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: [
          { subscription: { status: 'asc' } }, // ACTIVE first
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isEmailVerified: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
          profile: true,
          subscription: { select: { status: true, interval: true, currentPeriodEnd: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    sendSuccess(res, { members, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// ── GET /nutritionist/members/:memberId ───────────────────────────────────────

router.get('/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const member = await prisma.user.findUnique({
      where: { id: req.params.memberId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isEmailVerified: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
        subscription: { select: { status: true, interval: true, currentPeriodEnd: true } },
      },
    });
    if (!member) { sendNotFound(res, 'Member not found'); return; }
    sendSuccess(res, member);
  } catch (err) { next(err); }
});

// ── GET /nutritionist/members/:memberId/progress ──────────────────────────────

router.get('/members/:memberId/progress', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.params.memberId;
    const since30 = new Date(); since30.setDate(since30.getDate() - 30);
    const since7  = new Date(); since7.setDate(since7.getDate() - 7);

    const [profile, weightEntries, recentLogs, waterLogs, achievements] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.weightEntry.findMany({ where: { userId, loggedAt: { gte: since30 } }, orderBy: { loggedAt: 'asc' } }),
      prisma.mealLog.findMany({ where: { userId, loggedAt: { gte: since7 } } }),
      prisma.waterLog.findMany({ where: { userId, loggedAt: { gte: since7 } } }),
      prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true } }),
    ]);

    const avgKcal = recentLogs.length
      ? Math.round(recentLogs.reduce((s, l) => s + l.kcal, 0) / 7)
      : 0;

    const avgWater = waterLogs.length
      ? parseFloat((waterLogs.reduce((s, l) => s + l.amount, 0) / 7).toFixed(2))
      : 0;

    sendSuccess(res, {
      profile,
      weightEntries,
      weekSummary: { avgKcal, avgWater, mealsLogged: recentLogs.length },
      achievements: achievements.map((a) => ({ ...a.achievement, unlockedAt: a.unlockedAt })),
    });
  } catch (err) { next(err); }
});

// ── GET /nutritionist/members/:memberId/plans ─────────────────────────────────

router.get('/members/:memberId/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.mealPlan.findMany({
      where:   { userId: req.params.memberId },
      include: { items: { include: { meal: true }, orderBy: [{ dayOfWeek: 'asc' }, { mealType: 'asc' }] } },
      orderBy: { weekStart: 'desc' },
    });
    sendSuccess(res, plans);
  } catch (err) { next(err); }
});

// ── POST /nutritionist/members/:memberId/plans ────────────────────────────────

router.post('/members/:memberId/plans',
  [
    body('weekStart').isISO8601(),
    body('weekEnd').isISO8601(),
    body('items').isArray(),
    body('totalKcal').isInt({ min: 0 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weekStart, weekEnd, items, notes, totalKcal } = req.body;
      const userId = req.params.memberId;

      // Verify member exists and is premium
      const member = await prisma.user.findUnique({
        where: { id: userId },
        include: { subscription: true },
      });
      if (!member) throw new AppError('Member not found', 404);
      if (member.subscription?.status !== 'ACTIVE') {
        throw new AppError('Meal plans can only be created for premium members', 403);
      }

      const plan = await prisma.mealPlan.create({
        data: {
          userId,
          weekStart:  new Date(weekStart),
          weekEnd:    new Date(weekEnd),
          totalKcal,
          notes,
          status:     'DRAFT',
          createdBy:  req.user!.userId,
          items: {
            create: items
              .filter((s: any) => s.meal)
              .map((s: any) => ({
                mealId:    s.meal.id,
                dayOfWeek: s.dayOfWeek,
                mealType:  s.mealType,
              })),
          },
        },
        include: { items: { include: { meal: true } } },
      });

      logger.info(`Plan draft created for member ${userId} by nutritionist ${req.user!.userId}`);
      sendCreated(res, plan, 'Meal plan saved as draft');
    } catch (err) { next(err); }
  }
);

// ── PUT /nutritionist/members/:memberId/plans/:planId ─────────────────────────

router.put('/members/:memberId/plans/:planId',
  [body('items').isArray(), body('totalKcal').isInt({ min: 0 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId, memberId } = req.params;
      const { items, notes, totalKcal, weekStart, weekEnd } = req.body;

      const existing = await prisma.mealPlan.findFirst({ where: { id: planId, userId: memberId } });
      if (!existing) { sendNotFound(res, 'Plan not found'); return; }
      if (existing.status === 'PUBLISHED') throw new AppError('Published plans cannot be edited. Create a new plan.', 400);

      // Replace items — delete old, recreate
      await prisma.mealPlanItem.deleteMany({ where: { mealPlanId: planId } });

      const plan = await prisma.mealPlan.update({
        where: { id: planId },
        data: {
          totalKcal,
          notes,
          ...(weekStart && { weekStart: new Date(weekStart) }),
          ...(weekEnd   && { weekEnd:   new Date(weekEnd) }),
          updatedAt: new Date(),
          items: {
            create: items
              .filter((s: any) => s.meal)
              .map((s: any) => ({
                mealId:    s.meal.id,
                dayOfWeek: s.dayOfWeek,
                mealType:  s.mealType,
              })),
          },
        },
        include: { items: { include: { meal: true } } },
      });

      sendSuccess(res, plan, 'Plan updated');
    } catch (err) { next(err); }
  }
);

// ── POST /nutritionist/members/:memberId/plans/:planId/publish ────────────────

router.post('/members/:memberId/plans/:planId/publish',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId, memberId } = req.params;

      const plan = await prisma.mealPlan.findFirst({ where: { id: planId, userId: memberId } });
      if (!plan) { sendNotFound(res, 'Plan not found'); return; }
      if (plan.status === 'PUBLISHED') throw new AppError('Plan is already published', 400);

      // Must have at least 3 meals planned
      const itemCount = await prisma.mealPlanItem.count({ where: { mealPlanId: planId } });
      if (itemCount < 3) throw new AppError('Plan must have at least 3 meals before publishing', 400);

      await prisma.mealPlan.update({
        where: { id: planId },
        data:  { status: 'PUBLISHED', publishedAt: new Date() },
      });

      // Notify the member
      const member = await prisma.user.findUnique({ where: { id: memberId }, select: { name: true } });
      await notificationService.sendToUser(memberId, {
        title: '🎉 Your new meal plan is ready!',
        body:  `Your nutritionist has published your personalised meal plan for this week. Check it out!`,
        data:  { type: 'meal_plan_published', planId },
      });

      logger.info(`Plan ${planId} published for member ${memberId}`);
      sendSuccess(res, { planId, status: 'PUBLISHED' }, `Plan published — ${member?.name} has been notified`);
    } catch (err) { next(err); }
  }
);

// ── DELETE /nutritionist/members/:memberId/plans/:planId ──────────────────────

router.delete('/members/:memberId/plans/:planId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId, memberId } = req.params;
      const plan = await prisma.mealPlan.findFirst({ where: { id: planId, userId: memberId } });
      if (!plan) { sendNotFound(res, 'Plan not found'); return; }
      if (plan.status === 'PUBLISHED') throw new AppError('Cannot delete a published plan', 400);

      await prisma.mealPlan.delete({ where: { id: planId } });
      sendSuccess(res, null, 'Draft deleted');
    } catch (err) { next(err); }
  }
);

// ── POST /nutritionist/meals — add a meal to the library ─────────────────────

router.post('/meals',
  [
    body('name').trim().notEmpty(),
    body('type').isIn(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS']),
    body('kcal').isInt({ min: 0 }),
    body('protein').isFloat({ min: 0 }),
    body('carbs').isFloat({ min: 0 }),
    body('fats').isFloat({ min: 0 }),
    body('ingredients').isArray({ min: 1 }),
    body('instructions').isArray({ min: 1 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meal = await prisma.meal.create({ data: req.body });
      sendCreated(res, meal, 'Meal added to library');
    } catch (err) { next(err); }
  }
);

export default router;
