import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { ZodError } from 'zod';
import type { NotificationJob } from '@nomer/shared';
import type { AppContext } from './context';
import type { Env } from './env';
import { AppError } from './lib/errors';
import { formatZodError } from './lib/validate';
import { authenticate, requireAdmin, requireInternal } from './plugins/auth';
import { adminRoutes } from './routes/admin';
import { arenaRoutes } from './routes/arena';
import { cardRoutes } from './routes/cards';
import { carRoutes } from './routes/cars';
import { collectionRoutes } from './routes/collection';
import { gameRoutes } from './routes/game';
import { internalRoutes } from './routes/internal';
import { publicRoutes } from './routes/public';
import { ConfigService } from './services/config';
import { LeaderboardService } from './services/leaderboard';
import { Notifier } from './services/notifier';

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue<NotificationJob>;
  now?: () => Date;
}

export async function createApp(deps: AppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { env, prisma, redis, queue } = deps;
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  const config = new ConfigService(prisma, redis);
  const ctx: AppContext = {
    env,
    prisma,
    redis,
    config,
    leaderboard: new LeaderboardService(prisma, redis, async () => (await config.get()).config),
    notifier: new Notifier(queue, app.log),
    log: app.log,
    now: deps.now ?? (() => new Date()),
  };

  app.decorateRequest('user', null);
  // BigInt (Telegram ID) не сериализуется стандартным JSON.stringify.
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  );

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'bad_request', message: formatZodError(err) } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: err.message } });
    }
    req.log.error({ err }, 'Необработанная ошибка');
    return reply.status(500).send({ error: { code: 'internal', message: 'Внутренняя ошибка сервера' } });
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  await publicRoutes(app, ctx);
  await cardRoutes(app, ctx);

  await app.register(
    async (api) => {
      api.addHook('preHandler', authenticate(ctx));
      await gameRoutes(api, ctx);
      await collectionRoutes(api, ctx);
      await carRoutes(api, ctx);
      await arenaRoutes(api, ctx);
      await api.register(
        async (admin) => {
          admin.addHook('preHandler', requireAdmin(ctx));
          await adminRoutes(admin, ctx);
        },
        { prefix: '/admin' },
      );
    },
    { prefix: '/api' },
  );

  await app.register(
    async (internal) => {
      internal.addHook('preHandler', requireInternal(ctx));
      await internalRoutes(internal, ctx);
    },
    { prefix: '/internal' },
  );

  return { app, ctx };
}
