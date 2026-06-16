import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode = 500,
    public errors?: unknown[]
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  logger.error({ message: err.message, path: req.path, method: req.method, userId: req.user?.userId });

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, message: err.message, ...(err.errors && { errors: err.errors }) });
    return;
  }

  // Prisma unique constraint
  if ((err as any).code === 'P2002') {
    res.status(409).json({ success: false, message: 'A record with this value already exists' });
    return;
  }
  // Prisma not found
  if ((err as any).code === 'P2025') {
    res.status(404).json({ success: false, message: 'Record not found' });
    return;
  }

  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found` });
};
