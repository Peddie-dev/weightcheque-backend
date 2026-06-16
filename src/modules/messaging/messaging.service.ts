import prisma from '../../config/prisma';
import { AppError } from '../../middleware/errorHandler';
import { notificationService } from '../notifications/notification.service';
import { logger } from '../../config/logger';

export const messagingService = {

  // ── Get or create a conversation between member ↔ nutritionist ──────────

  async getOrCreateConversation(memberId: string, nutritionistId: string) {
    const existing = await prisma.conversation.findUnique({
      where: { memberId_nutritionistId: { memberId, nutritionistId } },
    });
    if (existing) return existing;

    return prisma.conversation.create({
      data: { memberId, nutritionistId },
      include: {
        member:       { select: { id: true, name: true, avatarUrl: true } },
        nutritionist: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  },

  // ── List conversations for a user (member or nutritionist) ───────────────

  async listConversations(userId: string, role: string) {
    const where = role === 'NUTRITIONIST' || role === 'ADMIN'
      ? { nutritionistId: userId }
      : { memberId: userId };

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        member:       { select: { id: true, name: true, avatarUrl: true } },
        nutritionist: { select: { id: true, name: true, avatarUrl: true } },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { body: true, sentAt: true, readAt: true, senderRole: true },
        },
      },
    });

    return conversations.map((c) => {
      const lastMsg = c.messages[0];
      const unreadCount = 0; // will calculate below per user
      return {
        id:              c.id,
        memberId:        c.memberId,
        memberName:      c.member.name,
        memberAvatar:    c.member.avatarUrl,
        nutritionistId:  c.nutritionistId,
        lastMessage:     lastMsg?.body ?? null,
        lastMessageAt:   lastMsg?.sentAt ?? null,
        unreadCount,    // enriched in the route
      };
    });
  },

  // ── Get messages in a conversation (paginated) ───────────────────────────

  async getMessages(conversationId: string, requesterId: string, page = 1, limit = 40) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new AppError('Conversation not found', 404);

    const isParticipant =
      conversation.memberId === requesterId || conversation.nutritionistId === requesterId;
    if (!isParticipant) throw new AppError('Access denied', 403);

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where:   { conversationId },
        orderBy: { sentAt: 'asc' },
        skip,
        take:    limit,
        include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      }),
      prisma.message.count({ where: { conversationId } }),
    ]);

    return { messages, total, page, totalPages: Math.ceil(total / limit) };
  },

  // ── Send a message ────────────────────────────────────────────────────────

  async sendMessage(
    conversationId: string,
    senderId: string,
    senderRole: 'USER' | 'NUTRITIONIST',
    body: string
  ) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new AppError('Conversation not found', 404);

    const isParticipant =
      conversation.memberId === senderId || conversation.nutritionistId === senderId;
    if (!isParticipant) throw new AppError('Access denied', 403);

    const [message] = await Promise.all([
      prisma.message.create({
        data: { conversationId, senderId, senderRole, body },
        include: { sender: { select: { id: true, name: true } } },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data:  { lastMessageAt: new Date(), lastMessageBody: body },
      }),
    ]);

    // Push notification to the other party
    const recipientId = senderRole === 'NUTRITIONIST'
      ? conversation.memberId
      : conversation.nutritionistId;

    const senderName = message.sender.name;

    await notificationService.sendToUser(recipientId, {
      title: `💬 New message from ${senderName}`,
      body:  body.length > 80 ? `${body.slice(0, 80)}…` : body,
      data:  { type: 'new_message', conversationId, senderId },
    }).catch(() => {}); // non-fatal

    logger.info(`Message sent in conversation ${conversationId} by ${senderId}`);
    return message;
  },

  // ── Mark all messages in a conversation as read ───────────────────────────

  async markRead(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new AppError('Conversation not found', 404);

    const isParticipant =
      conversation.memberId === userId || conversation.nutritionistId === userId;
    if (!isParticipant) throw new AppError('Access denied', 403);

    // Mark messages not sent by this user as read
    await prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data:  { readAt: new Date() },
    });
  },

  // ── Get unread count for a user ───────────────────────────────────────────

  async unreadCount(userId: string) {
    const conversations = await prisma.conversation.findMany({
      where: { OR: [{ memberId: userId }, { nutritionistId: userId }] },
      select: { id: true },
    });

    const ids = conversations.map((c) => c.id);
    return prisma.message.count({
      where: { conversationId: { in: ids }, senderId: { not: userId }, readAt: null },
    });
  },
};
