import prisma from '../../config/prisma';
import { logger } from '../../config/logger';

// Lazy import to avoid circular dependency with notification service
async function pushAchievement(userId: string, title: string, body: string) {
  try {
    const { notificationService } = await import('../notifications/notification.service');
    await notificationService.sendToUser(userId, { title, body, data: { type: 'achievement' } });
  } catch { /* non-fatal */ }
}

export const achievementService = {
  async checkWeightAchievements(userId: string, currentWeight: number) {
    try {
      const profile = await prisma.userProfile.findUnique({ where: { userId } });
      if (!profile) return;
      const lost = profile.startWeight - currentWeight;
      if (lost >= 3) await this._unlock(userId, 'first_3kg_lost');
      if (currentWeight <= profile.targetWeight) await this._unlock(userId, 'weight_goal');
    } catch (err) { logger.error('Weight achievement check failed', { err }); }
  },

  async checkStreakAchievements(userId: string, streak: number) {
    try {
      if (streak >= 7)  await this._unlock(userId, 'streak_7');
      if (streak >= 30) await this._unlock(userId, 'streak_30');
    } catch (err) { logger.error('Streak achievement check failed', { err }); }
  },

  async checkMealLogAchievements(userId: string) {
    try {
      const count = await prisma.mealLog.count({ where: { userId } });
      if (count === 1) await this._unlock(userId, 'first_meal_logged');
    } catch (err) { logger.error('Meal log achievement check failed', { err }); }
  },

  async checkGroceryAchievements(userId: string) {
    try { await this._unlock(userId, 'grocery_complete'); }
    catch (err) { logger.error('Grocery achievement check failed', { err }); }
  },

  async _unlock(userId: string, key: string) {
    const achievement = await prisma.achievement.findUnique({ where: { key } });
    if (!achievement) return;

    const existing = await prisma.userAchievement.findUnique({
      where: { userId_achievementId: { userId, achievementId: achievement.id } },
    });
    if (existing) return;

    await prisma.userAchievement.create({ data: { userId, achievementId: achievement.id } });

    await pushAchievement(
      userId,
      '🏆 Achievement Unlocked!',
      `${achievement.icon} ${achievement.title} — ${achievement.description}`
    );

    logger.info(`Achievement unlocked: ${key} → ${userId}`);
  },
};
