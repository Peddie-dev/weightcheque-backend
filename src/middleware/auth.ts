import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt';
import { sendUnauthorized, sendForbidden } from '../utils/response';

declare global {
  namespace Express {
    interface Request { user?: JwtPayload; }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) { sendUnauthorized(res, 'No token provided'); return; }
  try {
    req.user = verifyAccessToken(authHeader.slice(7));
    next();
  } catch {
    sendUnauthorized(res, 'Invalid or expired token');
  }
};

export const requireRole = (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { sendUnauthorized(res); return; }
    if (!roles.includes(req.user.role)) { sendForbidden(res, 'Insufficient permissions'); return; }
    next();
  };

export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try { req.user = verifyAccessToken(authHeader.slice(7)); } catch { /* ignore */ }
  }
  next();
};
