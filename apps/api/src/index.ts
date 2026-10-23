import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { NOTIFICATION_QUEUE, type NotificationJob } from '@nomer/shared';
import { createApp } from './app';
import { loadEnv } from './env';
import { rebuildLeaderboards } from './services/admin';
import { startScheduler } from './services/scheduler';
import { syncCarCatalog } from './services/showroom';

const env = loadEnv();
const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);
const queue = new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
  connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
});

const { app, ctx } = await createApp({ env, prisma, redis, queue });

// Конфиг по умолчанию создаётся при первом запуске; каталог машин синхронизируется с кодом;
// рейтинги восстанавливаются, если Redis пуст.
await ctx.config.get();
await syncCarCatalog(prisma);
if (await ctx.leaderboard.isEmpty()) {
  app.log.info('Рейтинги пусты — пересобираю из БД');
  await rebuildLeaderboards(ctx);
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });
const stopScheduler = startScheduler(ctx);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Остановка');
  stopScheduler();
  await app.close();
  await queue.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
