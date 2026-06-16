import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { config } from '../../config';
import { logger } from '../../config/logger';

const expo = new Expo({ accessToken: config.EXPO_ACCESS_TOKEN, useFcmV1: true });

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export const notificationService = {
  async registerToken(userId: string, token: string, platform: string) {
    if (!Expo.isExpoPushToken(token)) throw new Error(`Invalid Expo push token: ${token}`);
    await prisma.pushToken.upsert({
      where: { token },
      update: { isActive: true, platform, updatedAt: new Date() },
      create: { userId, token, platform },
    });
    logger.info(`Push token registered for user ${userId}`);
  },

  async deactivateToken(token: string) {
    await prisma.pushToken.updateMany({ where: { token }, data: { isActive: false } });
  },

  async sendToUser(userId: string, payload: PushPayload) {
    const tokens = await prisma.pushToken.findMany({ where: { userId, isActive: true } });
    if (!tokens.length) return;

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({ to: t.token, title: payload.title, body: payload.body, data: payload.data, sound: payload.sound ?? 'default' }));

    await this._send(messages);

    await prisma.notification.create({
      data: {
        userId,
        title: payload.title,
        body: payload.body,
        data: (payload.data ?? {}) as Prisma.InputJsonValue,
        type: (payload.data?.type as string) ?? 'system',
      },
    });
  },

  async sendWaterReminderToAll() {
    logger.info('💧 Running water reminder job...');

    const activeTokenUsers = await prisma.pushToken.findMany({ where: { isActive: true }, distinct: ['userId'], select: { userId: true } });

    const messages: ExpoPushMessage[] = [];
    let skipped = 0;

    for (const { userId } of activeTokenUsers) {
      const start = new Date(); start.setHours(0, 0, 0, 0);

      const [waterAgg, profile] = await Promise.all([
        prisma.waterLog.aggregate({ where: { userId, loggedAt: { gte: start } }, _sum: { amount: true } }),
        prisma.userProfile.findUnique({ where: { userId }, select: { dailyWaterGoal: true } }),
      ]);

      const consumed = waterAgg._sum.amount ?? 0;
      const goal     = profile?.dailyWaterGoal ?? 2.5;
      if (consumed >= goal) { skipped++; continue; }

      const remaining = (goal - consumed).toFixed(1);
      const tokens    = await prisma.pushToken.findMany({ where: { userId, isActive: true } });

      const userMessages: ExpoPushMessage[] = tokens
        .filter((t) => Expo.isExpoPushToken(t.token))
        .map((t) => ({
          to: t.token,
          title: '💧 Time to Hydrate!',
          body: `You've had ${consumed.toFixed(1)}L today — drink ${remaining}L more to hit your ${goal}L goal.`,
          sound: 'default' as const,
          data: { type: 'water_reminder' },
        }));

      messages.push(...userMessages);

      await prisma.notification.create({
        data: { userId, title: '💧 Time to Hydrate!', body: `${remaining}L remaining`, type: 'water_reminder', data: { consumed, goal, remaining } },
      });
    }

    if (messages.length) {
      await this._send(messages);
      logger.info(`💧 Water reminders sent to ${messages.length} device(s) (${skipped} users already hit goal)`);
    } else {
      logger.info('💧 No water reminders needed — all users on track');
    }
  },

  async sendMealReminder(userId: string, mealType: string) {
    const labels: Record<string, string> = {
      BREAKFAST: '🌅 Good morning! Time for breakfast.',
      LUNCH:     '☀️ Lunch time! Your meal plan is ready.',
      DINNER:    '🌙 Time for dinner — stay on track!',
      SNACKS:    '🥜 Snack time!',
    };
    await this.sendToUser(userId, {
      title: labels[mealType] ?? '🍽️ Meal Reminder',
      body:  'Check your personalized meal plan for today.',
      data:  { type: 'meal_reminder', mealType },
    });
  },

  async getForUser(userId: string, limit = 30) {
    return prisma.notification.findMany({ where: { userId }, orderBy: { sentAt: 'desc' }, take: limit });
  },

  async markRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({ where: { id: notificationId, userId }, data: { readAt: new Date() } });
  },

  async _send(messages: ExpoPushMessage[]) {
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket.status === 'error') {
            logger.warn('Push error', { details: ticket.details });
            if (ticket.details?.error === 'DeviceNotRegistered') {
              const to = chunk[i].to;
              if (typeof to === 'string') await this.deactivateToken(to);
            }
          }
        }
      } catch (err) {
        logger.error('Chunk send failed', { err });
      }
    }
  },
};
