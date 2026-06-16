import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendCreated, sendBadRequest } from '../../utils/response';
import { messagingService } from './messaging.service';
import { emitToConversation } from '../../config/socket';

const router = Router();
router.use(authenticate);

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { sendBadRequest(res, 'Validation failed', errors.array()); return; }
  next();
};

// ── GET /messaging/conversations ──────────────────────────────────────────────
// Works for both members (sees their convo) and nutritionists (sees all their convos)

router.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, role } = req.user!;
    const conversations = await messagingService.listConversations(userId, role);

    // Enrich each with unread count
    const enriched = await Promise.all(
      conversations.map(async (c) => {
        const unread = await import('../../config/prisma').then(({ default: prisma }) =>
          prisma.message.count({
            where: {
              conversationId: c.id,
              senderId:       { not: userId },
              readAt:         null,
            },
          })
        );
        return { ...c, unreadCount: unread };
      })
    );

    sendSuccess(res, enriched);
  } catch (err) { next(err); }
});

// ── POST /messaging/conversations ─────────────────────────────────────────────
// Member initiates a conversation with their nutritionist
// Nutritionist initiates with a member

router.post('/conversations',
  [body('otherUserId').notEmpty()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, role } = req.user!;
      const { otherUserId }  = req.body;

      const memberId       = role === 'USER' ? userId : otherUserId;
      const nutritionistId = role === 'USER' ? otherUserId : userId;

      const conversation = await messagingService.getOrCreateConversation(memberId, nutritionistId);
      sendCreated(res, conversation, 'Conversation ready');
    } catch (err) { next(err); }
  }
);

// ── GET /messaging/conversations/:id/messages ─────────────────────────────────

router.get('/conversations/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt((req.query.page as string) ?? '1');
    const data = await messagingService.getMessages(req.params.id, req.user!.userId, page);
    sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ── POST /messaging/conversations/:id/messages ────────────────────────────────

router.post('/conversations/:id/messages',
  [body('body').trim().isLength({ min: 1, max: 2000 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, role } = req.user!;
      const senderRole = role === 'USER' ? 'USER' : 'NUTRITIONIST';

      const message = await messagingService.sendMessage(
        req.params.id, userId, senderRole as any, req.body.body
      );
      // Also push to socket room so other party sees it in real-time
      emitToConversation(req.params.id, 'new_message', message);
      sendCreated(res, message, 'Message sent');
    } catch (err) { next(err); }
  }
);

// ── PATCH /messaging/conversations/:id/read ───────────────────────────────────

router.patch('/conversations/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await messagingService.markRead(req.params.id, req.user!.userId);
    sendSuccess(res, null, 'Marked as read');
  } catch (err) { next(err); }
});

// ── GET /messaging/unread-count ───────────────────────────────────────────────

router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await messagingService.unreadCount(req.user!.userId);
    sendSuccess(res, { count });
  } catch (err) { next(err); }
});

// ── Nutritionist-scoped aliases (used by dashboard) ───────────────────────────
// These mirror the above but are mounted under /nutritionist/conversations

export const nutritionistMessagingRouter = Router();
nutritionistMessagingRouter.use(authenticate);

nutritionistMessagingRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const convos = await messagingService.listConversations(req.user!.userId, req.user!.role);
    const enriched = await Promise.all(
      convos.map(async (c) => {
        const prisma = (await import('../../config/prisma')).default;
        const unread = await prisma.message.count({
          where: { conversationId: c.id, senderId: { not: req.user!.userId }, readAt: null },
        });
        return { ...c, unreadCount: unread };
      })
    );
    sendSuccess(res, enriched);
  } catch (err) { next(err); }
});

nutritionistMessagingRouter.get('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt((req.query.page as string) ?? '1');
    sendSuccess(res, await messagingService.getMessages(req.params.id, req.user!.userId, page));
  } catch (err) { next(err); }
});

nutritionistMessagingRouter.post('/:id/messages',
  [body('body').trim().isLength({ min: 1, max: 2000 })],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const msg = await messagingService.sendMessage(
        req.params.id, req.user!.userId, 'NUTRITIONIST', req.body.body
      );
      emitToConversation(req.params.id, 'new_message', msg);
      sendCreated(res, msg, 'Sent');
    } catch (err) { next(err); }
  }
);

nutritionistMessagingRouter.patch('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await messagingService.markRead(req.params.id, req.user!.userId);
    sendSuccess(res, null, 'Marked as read');
  } catch (err) { next(err); }
});

export default router;
