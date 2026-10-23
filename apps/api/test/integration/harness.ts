import { PrismaClient, type User } from '@prisma/client';
import type { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { vi } from 'vitest';
import type { NotificationJob } from '@nomer/shared';
import { createApp } from '../../src/app';
import { loadEnv } from '../../src/env';
import { signInitData } from '../../src/lib/telegram-auth';
import { syncCarCatalog } from '../../src/services/showroom';

export const INTEGRATION = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL);

export const BOT_TOKEN = '123456:TEST-integration-bot-token';
export const ADMIN_TG_ID = 1;

const TABLES = [
  'ExhibitionVote', 'ExhibitionEntry', 'Exhibition', 'AuctionBid', 'Auction', 'Race', 'RaceQueueEntry',
  'CarTrip', 'CarListing', 'CarOwnership', 'UserCar', 'ClubMember', 'Club', 'DreamMask', 'UserAchievement',
  'SchedulerRun', 'TradeItem', 'TradeOffer', 'Listing', 'PlateOwnership', 'RollLog', 'DealLog', 'LedgerEntry',
  'Payment', 'QuestProgress', 'Plate', 'User', 'GameConfigVersion',
];

export async function createHarness() {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL,
    BOT_TOKEN,
    BOT_USERNAME: 'nomer_test_bot',
    INTERNAL_API_TOKEN: 'internal-token-for-tests-0123456789',
    ADMIN_TELEGRAM_IDS: String(ADMIN_TG_ID),
  });
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const redis = new Redis(env.REDIS_URL);
  const sent: NotificationJob[] = [];
  const queue = {
    add: vi.fn(async (_name: string, job: NotificationJob) => {
      sent.push(job);
      return {} as never;
    }),
  } as unknown as Queue<NotificationJob>;

  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await redis.flushdb();
  await syncCarCatalog(prisma);
  await prisma.carModel.updateMany({ data: { sold: 0 } });

  // Игровые часы: идут вместе с реальными, но их можно перевести вперёд (кулдауны, поездки, аукцион).
  let offsetMs = 0;
  const clock = {
    now: () => new Date(Date.now() + offsetMs),
    advance: (ms: number) => {
      offsetMs += ms;
    },
  };

  const { app, ctx } = await createApp({ env, prisma, redis, queue, now: clock.now });
  await app.ready();

  async function login(telegramId: number, opts: { firstName?: string; startParam?: string } = {}) {
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: telegramId, first_name: opts.firstName ?? `User${telegramId}`, language_code: 'ru' }),
    };
    if (opts.startParam) fields.start_param = opts.startParam;
    const headers = { authorization: `tma ${signInitData(fields, BOT_TOKEN)}` };
    const res = await app.inject({ method: 'POST', url: '/api/auth', headers });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
    return { headers, user };
  }

  /** Выставляет баланс напрямую (минуя журнал) — только для подготовки тестов. */
  async function setBalance(user: User, data: { chips?: number; rolls?: number; lastFreeRollAt?: Date | null }) {
    await prisma.user.update({ where: { id: user.id }, data });
  }

  /** Снимает кулдаун выбивания, чтобы тесты могли выбивать подряд. */
  async function clearCooldowns() {
    const keys = await redis.keys('cd:*');
    if (keys.length) await redis.del(...keys);
  }

  async function close() {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  }

  /** Запрос к API с разбором JSON; бросает, если ожидался успех, а пришла ошибка. */
  async function api<T = any>(
    headers: Record<string, string>,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: T; error: string | undefined }> {
    const res = await app.inject({ method, url: `/api${url}`, headers, payload: payload as object | undefined });
    const body = res.json() as T & { error?: { code: string } };
    return { status: res.statusCode, body, error: body?.error?.code };
  }

  return { app, ctx, prisma, redis, sent, clock, login, setBalance, clearCooldowns, api, close };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
