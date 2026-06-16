import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import prisma from '../../config/prisma';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendCreated, sendNotFound } from '../../utils/response';
import { MealType } from '@prisma/client';

const router = Router();
router.use(authenticate);

// GET /meals — browse with filters
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, dietType, maxKcal, minProtein, search, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where: any = { isActive: true };
    if (type)       where.type = type.toUpperCase();
    if (dietType)   where.dietTypes = { has: dietType.toUpperCase() };
    if (maxKcal)    where.kcal = { lte: parseInt(maxKcal) };
    if (minProtein) where.protein = { gte: parseFloat(minProtein) };
    if (search)     where.name = { contains: search, mode: 'insensitive' };

    const [meals, total] = await Promise.all([
      prisma.meal.findMany({ where, skip, take: parseInt(limit), orderBy: { name: 'asc' } }),
      prisma.meal.count({ where }),
    ]);
    sendSuccess(res, meals, 'OK', 200, { total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /meals/plan/today
router.get('/plan/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7;

    const plan = await prisma.mealPlan.findFirst({
      where: { userId, weekStart: { lte: today }, weekEnd: { gte: today } },
      include: { items: { where: { dayOfWeek }, include: { meal: true }, orderBy: { mealType: 'asc' } } },
    });

    if (!plan) {
      const profile = await prisma.userProfile.findUnique({ where: { userId } });
      const defaultMeals = await prisma.meal.findMany({
        where: { isActive: true, ...(profile?.dietType && { dietTypes: { has: profile.dietType } }) },
        take: profile?.mealsPerDay ?? 3,
        orderBy: { type: 'asc' },
      });
      sendSuccess(res, { plan: null, meals: defaultMeals, isDefault: true });
      return;
    }

    sendSuccess(res, {
      plan,
      meals: plan.items.map((i) => ({ ...i.meal, planItemId: i.id, completed: i.completed })),
    });
  } catch (err) { next(err); }
});

// GET /meals/plan/week
router.get('/plan/week', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const today = new Date();
    const plan = await prisma.mealPlan.findFirst({
      where: { userId: req.user!.userId, weekStart: { lte: today }, weekEnd: { gte: today } },
      include: { items: { include: { meal: true }, orderBy: [{ dayOfWeek: 'asc' }, { mealType: 'asc' }] } },
    });
    sendSuccess(res, plan);
  } catch (err) { next(err); }
});

// GET /meals/log/today
router.get('/log/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(); end.setHours(23, 59, 59, 999);

    const [logs, profile] = await Promise.all([
      prisma.mealLog.findMany({ where: { userId, loggedAt: { gte: start, lte: end } }, orderBy: { loggedAt: 'asc' } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ]);

    const totalKcal = logs.reduce((s, l) => s + l.kcal, 0);
    const goalKcal  = profile?.dailyKcalGoal ?? 1800;
    sendSuccess(res, {
      logs,
      summary: {
        totalKcal, goalKcal,
        remainingKcal: Math.max(0, goalKcal - totalKcal),
        completionPct: Math.min(100, Math.round((totalKcal / goalKcal) * 100)),
        totalProtein: logs.reduce((s, l) => s + l.protein, 0),
        totalCarbs:   logs.reduce((s, l) => s + l.carbs, 0),
        totalFats:    logs.reduce((s, l) => s + l.fats, 0),
      },
    });
  } catch (err) { next(err); }
});

// GET /meals/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meal = await prisma.meal.findUnique({ where: { id: req.params.id } });
    if (!meal) { sendNotFound(res, 'Meal not found'); return; }
    sendSuccess(res, meal);
  } catch (err) { next(err); }
});

// GET /meals/:id/alternatives
router.get('/:id/alternatives', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const original = await prisma.meal.findUnique({ where: { id: req.params.id } });
    if (!original) { sendNotFound(res, 'Meal not found'); return; }

    const profile = await prisma.userProfile.findUnique({ where: { userId: req.user!.userId } });
    const alts = await prisma.meal.findMany({
      where: {
        id: { not: original.id }, type: original.type, isActive: true,
        ...(profile?.dietType && { dietTypes: { has: profile.dietType } }),
        kcal: { gte: original.kcal - 150, lte: original.kcal + 150 },
      },
      take: 5,
    });
    sendSuccess(res, alts);
  } catch (err) { next(err); }
});

// POST /meals/plan/items/:itemId/complete
router.post('/plan/items/:itemId/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.mealPlanItem.findUnique({
      where: { id: req.params.itemId },
      include: { mealPlan: { select: { userId: true } } },
    });
    if (!item || item.mealPlan.userId !== req.user!.userId) { sendNotFound(res, 'Not found'); return; }

    const updated = await prisma.mealPlanItem.update({
      where: { id: item.id },
      data: { completed: !item.completed, completedAt: item.completed ? null : new Date() },
    });
    sendSuccess(res, updated, updated.completed ? 'Meal marked complete' : 'Unmarked');
  } catch (err) { next(err); }
});

// POST /meals/log
router.post('/log',
  [body('name').trim().notEmpty(), body('mealType').isIn(Object.values(MealType)), body('kcal').isInt({ min: 0 })],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const log = await prisma.mealLog.create({
        data: {
          userId: req.user!.userId,
          mealId: req.body.mealId ?? null,
          name: req.body.name, mealType: req.body.mealType,
          kcal: req.body.kcal, protein: req.body.protein ?? 0,
          carbs: req.body.carbs ?? 0, fats: req.body.fats ?? 0,
          notes: req.body.notes,
        },
      });
      sendCreated(res, log, 'Meal logged');
    } catch (err) { next(err); }
  }
);

export default router;
