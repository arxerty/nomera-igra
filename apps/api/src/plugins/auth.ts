import { timingSafeEqual } from 'node:crypto';
import type { User } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { AppError, forbidden } from '../lib/errors';
import { hitRateLimit } from '../lib/rate-limit';
import { InitDataError, validateInitData, type ValidatedInitData } from '../lib/telegram-auth';
import { isAdmin } from '../services/users';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

const unauthorized = (message: string) => new AppError(401, 'unauthorized', message);

/** Общие лимиты на пользователя для всех авторизованных запросов. */
const API_LIMIT = { max: 300, windowSec: 60 };

/**
 * Разбирает заголовок Authorization:
 * - `tma <initData>` — подпись проверяется HMAC по токену бота на КАЖДОМ запросе;
 * - `dev <telegramId>` — только при DEV_AUTH=true вне production, для отладки в браузере.
 */
export function readInitData(ctx: AppContext, header: string | undefined): ValidatedInitData {
  const [scheme, ...rest] = (header ?? '').split(' ');
  const value = rest.join(' ').trim();

  if (scheme === 'tma' && value) {
    try {
      return validateInitData(value, ctx.env.BOT_TOKEN, ctx.env.INIT_DATA_MAX_AGE_SEC, ctx.now());
    } catch (err) {
      if (err instanceof InitDataError) throw unauthorized(err.message);
      throw err;
    }
  }
  if (scheme === 'dev' && ctx.env.DEV_AUTH && ctx.env.NODE_ENV !== 'production' && /^\d{1,15}$/.test(value)) {
    return {
      user: { id: Number(value), first_name: `Dev ${value}`, language_code: 'ru' },
      authDate: ctx.now(),
      startParam: null,
      dev: true,
    };
  }
  throw unauthorized('Нужна авторизация Telegram (Authorization: tma <initData>)');
}

export function authenticate(ctx: AppContext) {
  return async (req: FastifyRequest) => {
    const data = readInitData(ctx, req.headers.authorization);
    const user = await ctx.prisma.user.findUnique({ where: { telegramId: BigInt(data.user.id) } });
    if (!user) throw unauthorized('Сначала войдите: POST /api/auth');
    req.user = user;
    await hitRateLimit(ctx.redis, 'api', user.id, API_LIMIT.max, API_LIMIT.windowSec);
  };
}

export function requireAdmin(ctx: AppContext) {
  return async (req: FastifyRequest) => {
    if (!req.user || !isAdmin(ctx, req.user)) throw forbidden('Только для администраторов');
  };
}

export function requireInternal(ctx: AppContext) {
  const expected = Buffer.from(ctx.env.INTERNAL_API_TOKEN);
  return async (req: FastifyRequest) => {
    const got = Buffer.from(String(req.headers['x-internal-token'] ?? ''));
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw forbidden('Неверный внутренний токен');
  };
}

export function currentUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized('Нет пользователя');
  return req.user;
}
