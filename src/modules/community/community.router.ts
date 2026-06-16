import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { CommunityPostType, CommunityReactionType, Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import { config } from '../../config';
import { authenticate } from '../../middleware/auth';
import { sendBadRequest, sendCreated, sendNotFound, sendSuccess } from '../../utils/response';

const router = Router();
router.use(authenticate);

const FEED_PAGE_SIZE_DEFAULT = 15;
const FEED_PAGE_SIZE_MAX = 30;

function parseCursor(raw?: string): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const [iso, id] = raw.split('|');
  if (!iso || !id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

function buildCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

// GET /community/feed?cursor=...&limit=...
router.get('/feed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const viewerId = req.user!.userId;
    const limit = Math.min(
      FEED_PAGE_SIZE_MAX,
      Math.max(1, parseInt((req.query.limit as string) ?? `${FEED_PAGE_SIZE_DEFAULT}`, 10))
    );
    const cursor = parseCursor(req.query.cursor as string | undefined);

    const where: Prisma.CommunityPostWhereInput = {
      isHidden: false,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const posts = await prisma.communityPost.findMany({
      where,
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        reactions: {
          where: { userId: viewerId },
          select: { reactionType: true },
        },
      },
    });

    const hasMore = posts.length > limit;
    const pagePosts = hasMore ? posts.slice(0, limit) : posts;
    const nextCursor = hasMore
      ? buildCursor(pagePosts[pagePosts.length - 1].createdAt, pagePosts[pagePosts.length - 1].id)
      : null;

    const data = pagePosts.map((post) => ({
      id: post.id,
      type: post.type,
      content: post.content,
      milestoneKey: post.milestoneKey,
      milestoneMeta: post.milestoneMeta,
      visibility: post.visibility,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      reactionsCount: post.reactionsCount,
      createdAt: post.createdAt,
      author: post.author,
      media: post.media.map((m) => ({
        id: m.id,
        url: m.url,
        mimeType: m.mimeType,
        width: m.width,
        height: m.height,
      })),
      viewerReactions: post.reactions.map((r) => r.reactionType),
    }));

    sendSuccess(res, { items: data, nextCursor, hasMore });
  } catch (err) {
    next(err);
  }
});

// POST /community/posts
router.post(
  '/posts',
  [
    body('type').optional().isIn(Object.values(CommunityPostType)),
    body('content').optional().isString().isLength({ max: 1500 }),
    body('media').optional().isArray({ max: 6 }),
    body('media.*.url').optional().isString().isLength({ min: 1 }),
    body('milestoneKey').optional().isString().isLength({ max: 120 }),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authorId = req.user!.userId;
      const type = (req.body.type as CommunityPostType | undefined) ?? CommunityPostType.TEXT;
      const content = (req.body.content as string | undefined)?.trim() || null;
      const media = Array.isArray(req.body.media) ? req.body.media : [];
      const milestoneKey = (req.body.milestoneKey as string | undefined) ?? null;
      const milestoneMeta = (req.body.milestoneMeta as Record<string, unknown> | undefined) ?? null;

      if (!content && media.length === 0 && type !== CommunityPostType.MILESTONE) {
        sendBadRequest(res, 'Post must contain text or photos');
        return;
      }
      if (type === CommunityPostType.PHOTO && media.length === 0) {
        sendBadRequest(res, 'Photo posts require at least one image');
        return;
      }

      const created = await prisma.communityPost.create({
        data: {
          authorId,
          type,
          content,
          milestoneKey,
          milestoneMeta: milestoneMeta ? (milestoneMeta as Prisma.InputJsonValue) : undefined,
          media: media.length
            ? {
                create: media.map((m: any, index: number) => ({
                  url: m.url,
                  mimeType: m.mimeType ?? null,
                  width: m.width ?? null,
                  height: m.height ?? null,
                  sortOrder: index,
                })),
              }
            : undefined,
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
          media: { orderBy: { sortOrder: 'asc' } },
        },
      });

      sendCreated(res, created, 'Post created');
    } catch (err) {
      next(err);
    }
  }
);

// GET /community/posts/:postId/comments?cursor=...&limit=...
router.get('/posts/:postId/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const postId = req.params.postId;
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));
    const cursor = parseCursor(req.query.cursor as string | undefined);

    const post = await prisma.communityPost.findFirst({ where: { id: postId, isHidden: false }, select: { id: true } });
    if (!post) {
      sendNotFound(res, 'Post not found');
      return;
    }

    const comments = await prisma.communityComment.findMany({
      where: {
        postId,
        isDeleted: false,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });

    const hasMore = comments.length > limit;
    const pageComments = hasMore ? comments.slice(0, limit) : comments;
    const nextCursor = hasMore
      ? buildCursor(pageComments[pageComments.length - 1].createdAt, pageComments[pageComments.length - 1].id)
      : null;

    sendSuccess(res, { items: pageComments, nextCursor, hasMore });
  } catch (err) {
    next(err);
  }
});

// POST /community/posts/:postId/comments
router.post(
  '/posts/:postId/comments',
  [body('body').trim().notEmpty().isLength({ max: 800 })],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const postId = req.params.postId;

      const post = await prisma.communityPost.findFirst({ where: { id: postId, isHidden: false }, select: { id: true } });
      if (!post) {
        sendNotFound(res, 'Post not found');
        return;
      }

      const comment = await prisma.communityComment.create({
        data: { postId, authorId: userId, body: req.body.body },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      });

      await prisma.communityPost.update({
        where: { id: postId },
        data: { commentsCount: { increment: 1 } },
      });

      sendCreated(res, comment, 'Comment added');
    } catch (err) {
      next(err);
    }
  }
);

// POST /community/posts/:postId/reactions (toggle)
router.post(
  '/posts/:postId/reactions',
  [body('reactionType').isIn(Object.values(CommunityReactionType))],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const postId = req.params.postId;
      const reactionType = req.body.reactionType as CommunityReactionType;

      const post = await prisma.communityPost.findFirst({ where: { id: postId, isHidden: false }, select: { id: true } });
      if (!post) {
        sendNotFound(res, 'Post not found');
        return;
      }

      const existing = await prisma.communityReaction.findUnique({
        where: { postId_userId_reactionType: { postId, userId, reactionType } },
      });

      if (existing) {
        await prisma.communityReaction.delete({ where: { id: existing.id } });
        const likesDelta = reactionType === CommunityReactionType.LIKE ? -1 : 0;
        await prisma.communityPost.update({
          where: { id: postId },
          data: {
            reactionsCount: { decrement: 1 },
            likesCount: likesDelta !== 0 ? { decrement: 1 } : undefined,
          },
        });
        sendSuccess(res, { reacted: false });
        return;
      }

      await prisma.communityReaction.create({ data: { postId, userId, reactionType } });
      const likesDelta = reactionType === CommunityReactionType.LIKE ? 1 : 0;
      await prisma.communityPost.update({
        where: { id: postId },
        data: {
          reactionsCount: { increment: 1 },
          likesCount: likesDelta !== 0 ? { increment: 1 } : undefined,
        },
      });

      sendSuccess(res, { reacted: true });
    } catch (err) {
      next(err);
    }
  }
);

// POST /community/posts/:postId/report
router.post(
  '/posts/:postId/report',
  [body('reason').trim().notEmpty().isLength({ max: 120 }), body('details').optional().isString().isLength({ max: 1000 })],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reporterId = req.user!.userId;
      const postId = req.params.postId;

      const post = await prisma.communityPost.findUnique({ where: { id: postId } });
      if (!post || post.isHidden) {
        sendNotFound(res, 'Post not found');
        return;
      }

      try {
        await prisma.communityReport.create({
          data: {
            postId,
            reporterId,
            reason: req.body.reason,
            details: req.body.details ?? null,
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          sendBadRequest(res, 'You have already reported this post');
          return;
        }
        throw error;
      }

      const reportsCount = await prisma.communityReport.count({ where: { postId } });
      const shouldHide = reportsCount >= config.COMMUNITY_REPORT_HIDE_THRESHOLD;
      await prisma.communityPost.update({
        where: { id: postId },
        data: {
          reportsCount,
          isHidden: shouldHide,
          hiddenReason: shouldHide ? 'Auto-hidden after report threshold' : null,
        },
      });

      sendSuccess(res, { reportsCount, isHidden: shouldHide }, 'Report submitted');
    } catch (err) {
      next(err);
    }
  }
);

export default router;

