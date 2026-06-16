import { Response } from 'express';

export const sendSuccess = <T>(
  res: Response, data: T, message = 'Success', statusCode = 200,
  meta?: Record<string, unknown>
): Response =>
  res.status(statusCode).json({ success: true, message, data, ...(meta && { meta }) });

export const sendCreated = <T>(res: Response, data: T, message = 'Created'): Response =>
  sendSuccess(res, data, message, 201);

export const sendError = (
  res: Response, message: string, statusCode = 500, errors?: unknown[]
): Response =>
  res.status(statusCode).json({ success: false, message, ...(errors && { errors }) });

export const sendUnauthorized = (res: Response, message = 'Unauthorized'): Response =>
  sendError(res, message, 401);

export const sendForbidden = (res: Response, message = 'Forbidden'): Response =>
  sendError(res, message, 403);

export const sendNotFound = (res: Response, message = 'Not found'): Response =>
  sendError(res, message, 404);

export const sendBadRequest = (res: Response, message: string, errors?: unknown[]): Response =>
  sendError(res, message, 400, errors);
