import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import prisma from '../../config/prisma';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendCreated, sendNotFound } from '../../utils/response';
import { achievementService } from './achievement.service';

const router = Router();
router.use(authenticate);

// POST /progress/weight
router.post('/weight',
  [body('weight').isFloat({ min: 20, max: 500 })],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { weight, note } = req.body;
      const userId = req.user!.userId;
      const today = new Date(); today.setHours(0, 0, 0, 0);

      const entry = await prisma.weightEntry.upsert({
        where: { userId_loggedAt: { userId, loggedAt: today } },
        update: { weight, note },
        create: { userId, weight, note, loggedAt: today },
      });

      await prisma.userProfile.update({ where: { userId }, data: { currentWeight: weight } });
      await achievementService.checkWeightAchievements(userId, weight);

      sendSuccess(res, entry, 'Weight logged');
    } catch (err) { next(err); }
  }
);

// GET /progress/weight?days=30
router.get('/weight', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const days   = parseInt((req.query.days as string) ?? '30');
    const since  = new Date(); since.setDate(since.getDate() - days);

    const [entries, profile] = await Promise.all([
      prisma.weightEntry.findMany({ where: { userId, loggedAt: { gte: since } }, orderBy: { loggedAt: 'asc' } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ]);

    const totalLost  = profile ? parseFloat((profile.startWeight  - profile.currentWeight).toFixed(1)) : 0;
    const toGoal     = profile ? parseFloat((profile.currentWeight - profile.targetWeight).toFixed(1))  : 0;
    const totalNeeded = profile ? profile.startWeight - profile.targetWeight : 1;

    sendSuccess(res, {
      entries,
      summary: {
        startWeight:   profile?.startWeight,
        currentWeight: profile?.currentWeight,
        targetWeight:  profile?.targetWeight,
        totalLost,
        toGoal:  Math.max(0, toGoal),
        progressPct: Math.min(100, Math.round((totalLost / totalNeeded) * 100)),
      },
    });
  } catch (err) { next(err); }
});

// POST /progress/water
router.post('/water',
  [body('amount').isFloat({ min: 0.1, max: 5 })],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const log = await prisma.waterLog.create({
        data: { userId: req.user!.userId, amount: req.body.amount },
      });
      sendCreated(res, log, 'Water logged');
    } catch (err) { next(err); }
  }
);

// GET /progress/water/today
router.get('/water/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const start  = new Date(); start.setHours(0, 0, 0, 0);

    const [logs, profile] = await Promise.all([
      prisma.waterLog.findMany({ where: { userId, loggedAt: { gte: start } }, orderBy: { loggedAt: 'asc' } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ]);

    const total = logs.reduce((s, l) => s + l.amount, 0);
    const goal  = profile?.dailyWaterGoal ?? 2.5;

    sendSuccess(res, {
      logs,
      totalLitres:   parseFloat(total.toFixed(2)),
      goal,
      remaining:     parseFloat(Math.max(0, goal - total).toFixed(2)),
      completionPct: Math.min(100, Math.round((total / goal) * 100)),
    });
  } catch (err) { next(err); }
});

// GET /progress/achievements
router.get('/achievements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const [all, unlocked] = await Promise.all([
      prisma.achievement.findMany({ orderBy: { title: 'asc' } }),
      prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true } }),
    ]);
    const unlockedKeys = new Set(unlocked.map((u) => u.achievement.key));
    sendSuccess(res, {
      achievements: all.map((a) => ({
        ...a,
        unlocked: unlockedKeys.has(a.key),
        unlockedAt: unlocked.find((u) => u.achievement.key === a.key)?.unlockedAt ?? null,
      })),
      totalUnlocked: unlockedKeys.size,
      total: all.length,
    });
  } catch (err) { next(err); }
});

// GET /progress/streak
router.get('/streak', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId: req.user!.userId },
      select: { streak: true, longestStreak: true, lastActiveDate: true },
    });
    sendSuccess(res, profile ?? { streak: 0, longestStreak: 0, lastActiveDate: null });
  } catch (err) { next(err); }
});

// GET /progress/summary
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId   = req.user!.userId;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);

    const [profile, todayLogs, weekLogs, achievementCount] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.mealLog.findMany({ where: { userId, loggedAt: { gte: todayStart } } }),
      prisma.mealLog.findMany({ where: { userId, loggedAt: { gte: weekStart } } }),
      prisma.userAchievement.count({ where: { userId } }),
    ]);

    sendSuccess(res, {
      profile,
      today: { kcal: todayLogs.reduce((s, l) => s + l.kcal, 0), mealsLogged: todayLogs.length },
      week:  { avgKcal: weekLogs.length ? Math.round(weekLogs.reduce((s, l) => s + l.kcal, 0) / 7) : 0, mealsLogged: weekLogs.length },
      achievements: achievementCount,
    });
  } catch (err) { next(err); }
});

export default router;
