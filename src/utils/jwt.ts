import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface RefreshPayload {
  userId: string;
  tokenId: string;
}

export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions);

export const signRefreshToken = (payload: RefreshPayload): string =>
  jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);

export const verifyAccessToken = (token: string): JwtPayload =>
  jwt.verify(token, config.JWT_SECRET) as JwtPayload;

export const verifyRefreshToken = (token: string): RefreshPayload =>
  jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshPayload;
