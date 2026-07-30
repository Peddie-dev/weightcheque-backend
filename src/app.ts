import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// ── Routers ───────────────────────────────────────────────────────────────────
import authRouter           from './modules/auth/auth.router';
import mealsRouter          from './modules/meals/meals.router';
import progressRouter       from './modules/progress/progress.router';
import groceryRouter        from './modules/grocery/grocery.router';
import subscriptionRouter   from './modules/subscription/subscription.router';
import notificationRouter   from './modules/notifications/notification.router';
import recipesRouter        from './modules/recipes/recipes.router';
import nutritionistRouter   from './modules/nutritionist/nutritionist.router';
import messagingRouter, { nutritionistMessagingRouter } from './modules/messaging/messaging.router';
import communityRouter      from './modules/community/community.router';

export function createApp(): Application {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());

  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-paystack-signature'],
  }));

  app.use(compression());

  // Raw body for Paystack webhook — must be before express.json()
  app.use('/api/v1/subscription/webhook', express.raw({ type: 'application/json' }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/health',
  }));

  // Global rate limiter
  app.use(rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' },
  }));

  // Stricter limiter for auth
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many auth attempts, please try again later.' },
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: config.NODE_ENV, timestamp: new Date().toISOString() });
  });

  // ── API Routes ─────────────────────────────────────────────────────────────
  const p = config.API_PREFIX;

  app.use(`${p}/auth`,                    authLimiter, authRouter);
  app.use(`${p}/meals`,                   mealsRouter);
  app.use(`${p}/progress`,               progressRouter);
  app.use(`${p}/grocery`,                groceryRouter);
  app.use(`${p}/subscription`,           subscriptionRouter);
  app.use(`${p}/notifications`,          notificationRouter);
  app.use(`${p}/recipes`,                recipesRouter);
  app.use(`${p}/nutritionist`,           nutritionistRouter);
  app.use(`${p}/nutritionist/conversations`, nutritionistMessagingRouter);
  app.use(`${p}/messaging`,              messagingRouter);
  app.use(`${p}/community`,              communityRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
