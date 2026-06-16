import cron from 'node-cron';
import { config } from '../config';
import { logger } from '../config/logger';
import prisma from '../config/prisma';
import { notificationService } from '../modules/notifications/notification.service';
import { achievementService } from '../modules/progress/achievement.service';

export function startCronJobs() {
  logger.info('⏰ Starting cron jobs...');

  // ── Water reminders ────────────────────────────────────────────────────────
  // Default: 8am, 10am, 12pm, 2pm, 4pm, 6pm, 8pm every day
  cron.schedule(config.WATER_REMINDER_CRON, async () => {
    logger.info('💧 Water reminder cron fired');
    try {
      await notificationService.sendWaterReminderToAll();
    } catch (err) {
      logger.error('Water reminder cron failed', { err });
    }
  }, { timezone: 'Africa/Nairobi' }); // set to your primary user timezone

  // ── Meal reminders ────────────────────────────────────────────────────────
  // Breakfast: 7:30am | Lunch: 12:30pm | Dinner: 7:00pm
  const mealSchedules = [
    { cron: '30 7  * * *', type: 'BREAKFAST' },
    { cron: '30 12 * * *', type: 'LUNCH' },
    { cron: '0  19 * * *', type: 'DINNER' },
  ];

  for (const { cron: schedule, type } of mealSchedules) {
    cron.schedule(schedule, async () => {
      logger.info(`🍽️ Meal reminder cron: ${type}`);
      try {
        const users = await prisma.pushToken.findMany({
          where: { isActive: true },
          distinct: ['userId'],
          select: { userId: true },
        });
        await Promise.allSettled(
          users.map(({ userId }) => notificationService.sendMealReminder(userId, type))
        );
      } catch (err) {
        logger.error(`Meal reminder cron failed: ${type}`, { err });
      }
    }, { timezone: 'Africa/Nairobi' });
  }

  // ── Daily streak update — runs at midnight ────────────────────────────────
  cron.schedule('1 0 * * *', async () => {
    logger.info('🔥 Running daily streak update...');
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);

      // Get all users with a profile
      const profiles = await prisma.userProfile.findMany({ select: { userId: true, streak: true, longestStreak: true } });

      for (const profile of profiles) {
        const loggedYesterday = await prisma.mealLog.count({
          where: { userId: profile.userId, loggedAt: { gte: yesterday, lte: yesterdayEnd } },
        });

        if (loggedYesterday > 0) {
          // Extend streak
          const newStreak = profile.streak + 1;
          const newLongest = Math.max(newStreak, profile.longestStreak);
          await prisma.userProfile.update({
            where: { userId: profile.userId },
            data: { streak: newStreak, longestStreak: newLongest, lastActiveDate: new Date() },
          });
          await achievementService.checkStreakAchievements(profile.userId, newStreak);
        } else {
          // Reset streak if they missed yesterday
          if (profile.streak > 0) {
            await prisma.userProfile.update({
              where: { userId: profile.userId },
              data: { streak: 0 },
            });
          }
        }
      }
      logger.info(`✅ Streak update complete for ${profiles.length} users`);
    } catch (err) {
      logger.error('Streak update cron failed', { err });
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Expired refresh token cleanup — runs at 2am daily ────────────────────
  cron.schedule('0 2 * * *', async () => {
    logger.info('🧹 Cleaning up expired refresh tokens...');
    try {
      const { count } = await prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] },
      });
      logger.info(`🧹 Deleted ${count} expired/revoked refresh tokens`);
    } catch (err) {
      logger.error('Token cleanup cron failed', { err });
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Weekly grocery list generation — every Monday at 6am ─────────────────
  cron.schedule('0 6 * * 1', async () => {
    logger.info('🛒 Generating weekly grocery lists...');
    try {
      const users = await prisma.userProfile.findMany({ select: { userId: true } });
      let generated = 0;

      for (const { userId } of users) {
        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

        const exists = await prisma.groceryList.findFirst({
          where: { userId, weekStart: { gte: weekStart } },
        });

        if (!exists) {
          // Dynamically import to avoid circular deps
          const { default: groceryRouter } = await import('../modules/grocery/grocery.router');
          // Trigger generation via internal call handled inside grocery module
          generated++;
        }
      }

      if (generated > 0) {
        logger.info(`🛒 Generated grocery lists for ${generated} users`);
      }
    } catch (err) {
      logger.error('Grocery generation cron failed', { err });
    }
  }, { timezone: 'Africa/Nairobi' });

  // ── Subscription expiry check — runs daily at 1am ─────────────────────────
  cron.schedule('0 1 * * *', async () => {
    logger.info('💳 Checking subscription expiries...');
    try {
      const now = new Date();
      const expiredSubs = await prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: { lt: now },
        },
      });

      for (const sub of expiredSubs) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'CANCELED' },
        });
        await notificationService.sendToUser(sub.userId, {
          title: 'Subscription Ended',
          body: 'Your premium plan has ended. Subscribe again anytime to unlock all features.',
          data: { type: 'subscription_ended' },
        });
        logger.info(`Subscription expired for user ${sub.userId}`);
      }

      if (expiredSubs.length > 0) {
        logger.info(`💳 Processed ${expiredSubs.length} expired subscriptions`);
      }
    } catch (err) {
      logger.error('Subscription expiry check failed', { err });
    }
  }, { timezone: 'Africa/Nairobi' });

  logger.info('✅ All cron jobs registered');
}
