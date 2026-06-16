import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { messagingService } from '../modules/messaging/messaging.service';
import { logger } from '../config/logger';
import { config } from '../config';

export function setupSocketIO(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin:      config.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) { next(new Error('Unauthorized')); return; }
    try {
      (socket as any).user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user;
    logger.debug(`Socket connected: ${user.userId} (${user.role})`);

    // Join a conversation room
    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      logger.debug(`${user.userId} joined room conversation:${conversationId}`);
    });

    // Leave a conversation room
    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Send message via socket (alternative to REST)
    socket.on('send_message', async (payload: { conversationId: string; body: string }) => {
      try {
        const senderRole = user.role === 'USER' ? 'USER' : 'NUTRITIONIST';
        const message = await messagingService.sendMessage(
          payload.conversationId,
          user.userId,
          senderRole,
          payload.body
        );

        // Broadcast to all in the conversation room (except sender)
        socket.to(`conversation:${payload.conversationId}`).emit('new_message', message);

        // Also send back to sender with server timestamp
        socket.emit('message_sent', message);
      } catch (err) {
        socket.emit('message_error', { message: 'Failed to send message' });
        logger.error('Socket send_message error', { err });
      }
    });

    // Typing indicator
    socket.on('typing', (conversationId: string) => {
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId:   user.userId,
        userName: user.email,
      });
    });

    socket.on('stop_typing', (conversationId: string) => {
      socket.to(`conversation:${conversationId}`).emit('user_stop_typing', { userId: user.userId });
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${user.userId}`);
    });
  });

  return io;
}

// Helper: emit a new message to a conversation room from outside socket context
// (called by the REST messaging endpoint)
let _io: SocketServer | null = null;

export function getIO(): SocketServer | null { return _io; }
export function setIO(io: SocketServer): void { _io = io; }

export function emitToConversation(conversationId: string, event: string, data: unknown): void {
  if (!_io) return;
  _io.to(`conversation:${conversationId}`).emit(event, data);
}
