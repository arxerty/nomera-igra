import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from './env';
import type { ConfigService } from './services/config';
import type { LeaderboardService } from './services/leaderboard';
import type { Notifier } from './services/notifier';

export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  config: ConfigService;
  leaderboard: LeaderboardService;
  notifier: Notifier;
  log: FastifyBaseLogger;
  now: () => Date;
}

/** Ссылка, открывающая Mini App с параметром запуска (startapp). */
export function miniAppLink(ctx: AppContext, startParam?: string): string {
  const base = `https://t.me/${ctx.env.BOT_USERNAME}/${ctx.env.MINI_APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

/** Побочные действия после коммита (рейтинги, уведомления): ошибка логируется, но не ломает ответ. */
export async function afterCommit(ctx: AppContext, ...tasks: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') ctx.log.error({ err: r.reason }, 'Ошибка пост-коммит действия');
  }
}
