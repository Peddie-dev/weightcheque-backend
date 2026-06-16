import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  APP_URL: z.string().default('http://localhost:3000'),
  API_BASE_URL: z.string().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Paystack
  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_WEBHOOK_SECRET: z.string().min(1),
  PAYSTACK_MONTHLY_PLAN_CODE: z.string().min(1),
  PAYSTACK_YEARLY_PLAN_CODE: z.string().min(1),
  PAYSTACK_CURRENCY: z.string().default('NGN'),

  // Strapi
  STRAPI_BASE_URL: z.string().url(),
  STRAPI_API_TOKEN: z.string().min(1),

  // Expo
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Allow both the mobile dev server and the nutritionist dashboard.
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:19006'),
  COMMUNITY_REPORT_HIDE_THRESHOLD: z.coerce.number().default(5),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  BCRYPT_ROUNDS: z.coerce.number().default(12),
  WATER_REMINDER_CRON: z.string().default('0 8,10,12,14,16,18,20 * * *'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.errors.forEach((e) => console.error(`  ${e.path.join('.')}: ${e.message}`));
  process.exit(1);
}

export const config = parsed.data;
