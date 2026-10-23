import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  BOT_TOKEN: z.string().min(20),
  /** Имя бота без @ — для ссылок t.me/<bot>/<app>. */
  BOT_USERNAME: z.string().min(1),
  /** Короткое имя Mini App из BotFather (/newapp). */
  MINI_APP_SHORT_NAME: z.string().min(1).default('app'),
  /** Общий секрет для внутренних запросов бот → API. */
  INTERNAL_API_TOKEN: z.string().min(16),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default('')
    .transform((s) =>
      new Set(
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => BigInt(x)),
      ),
    ),
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().int().positive().default(86_400),
  CORS_ORIGIN: z.string().default('*'),
  /**
   * Только для локальной разработки в обычном браузере: заголовок
   * `Authorization: dev <telegramId>` вместо initData. В production игнорируется.
   */
  DEV_AUTH: bool,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректные переменные окружения:\n${issues}`);
  }
  return parsed.data;
}
