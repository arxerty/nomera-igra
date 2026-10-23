import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_TOKEN: z.string().min(20),
  BOT_USERNAME: z.string().min(1),
  MINI_APP_SHORT_NAME: z.string().min(1).default('app'),
  /** HTTPS-адрес фронтенда Mini App (для кнопки меню и /start). */
  WEB_APP_URL: z.string().url(),
  /** Адрес API изнутри сети (в Docker — http://api:3000). */
  API_INTERNAL_URL: z.string().url().default('http://localhost:3000'),
  /** Публичный HTTPS-адрес API — для PNG-карточек в inline-режиме. Без него шаринг идёт текстом. */
  PUBLIC_API_URL: z.string().url().optional(),
  INTERNAL_API_TOKEN: z.string().min(16),
  REDIS_URL: z.string().url(),
  /** Если задан — webhook вместо long polling. */
  BOT_WEBHOOK_URL: z.string().url().optional(),
  BOT_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
  BOT_PORT: z.coerce.number().int().default(8080),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректные переменные окружения бота:\n${issues}`);
  }
  return parsed.data;
}
