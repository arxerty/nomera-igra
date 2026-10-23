import { gameWeekKey } from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { withTx } from '../lib/db';
import { changeBalance } from '../lib/ledger';
import { ensureTodayAuction, settleAuctions } from './auction';
import { settleExhibitions } from './exhibition';
import { expireRaceQueue } from './races';

const WEEK = 7 * 86_400_000;
const LOCK_KEY = 'lock:scheduler';

/**
 * Призы недельного турнира гонок за прошлую неделю: места по числу побед,
 * при равенстве — у кого раньше последняя победа. Выдаётся один раз (SchedulerRun).
 */
export async function settleTournament(ctx: AppContext): Promise<boolean> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const week = gameWeekKey(new Date(now.getTime() - WEEK), config.economy.dayOffsetHours);
  const prizes = config.races.tournament.prizes;

  const awarded = await withTx(ctx.prisma, async (tx) => {
    const inserted = await tx.$executeRaw`
      INSERT INTO "SchedulerRun" (key, "ranAt") VALUES (${`tournament:${week}`}, ${now}) ON CONFLICT DO NOTHING`;
    if (inserted === 0) return null;
    const rows = await tx.$queryRaw<{ userId: string; wins: bigint }[]>`
      SELECT "winnerUserId" AS "userId", COUNT(*)::bigint AS wins, MAX("createdAt") AS last
      FROM "Race" WHERE "weekKey" = ${week} AND "winnerUserId" IS NOT NULL
      GROUP BY "winnerUserId" ORDER BY wins DESC, last ASC LIMIT ${prizes.length}`;
    const result: { userId: string; place: number; chips: number; rolls: number }[] = [];
    for (const [i, row] of rows.entries()) {
      const prize = prizes[i]!;
      const refId = `tournament:${week}:${i + 1}`;
      await changeBalance(tx, { userId: row.userId, currency: 'chips', delta: prize.chips, reason: 'prize', refId });
      await changeBalance(tx, { userId: row.userId, currency: 'rolls', delta: prize.rolls, reason: 'prize', refId });
      if (prize.paint) {
        await tx.$executeRaw`
          UPDATE "User" SET "unlockedPaints" = array_append("unlockedPaints", ${prize.paint})
          WHERE id = ${row.userId} AND NOT (${prize.paint} = ANY("unlockedPaints"))`;
      }
      result.push({ userId: row.userId, place: i + 1, chips: prize.chips, rolls: prize.rolls });
    }
    return result;
  });
  if (!awarded) return false;

  const users = await ctx.prisma.user.findMany({ where: { id: { in: awarded.map((a) => a.userId) } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  await afterCommit(
    ctx,
    ...awarded.map((a) =>
      ctx.notifier.send(byId.get(a.userId)!, { type: 'reward', reason: 'tournament', place: a.place, chips: a.chips, rolls: a.rolls }),
    ),
  );
  return true;
}

/** Один проход планировщика. Каждая задача идемпотентна, сбой одной не мешает остальным. */
export async function runScheduledTasks(ctx: AppContext): Promise<void> {
  const tasks: [string, () => Promise<unknown>][] = [
    ['settleAuctions', () => settleAuctions(ctx)],
    ['ensureTodayAuction', () => ensureTodayAuction(ctx)],
    ['settleExhibitions', () => settleExhibitions(ctx)],
    ['settleTournament', () => settleTournament(ctx)],
    ['expireRaceQueue', () => expireRaceQueue(ctx)],
  ];
  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      ctx.log.error({ err, task: name }, 'Ошибка задачи планировщика');
    }
  }
}

/**
 * Запускает планировщик каждые `intervalMs`. Блокировка в Redis не даёт
 * нескольким экземплярам API выполнять задачи одновременно. Возвращает функцию остановки.
 */
export function startScheduler(ctx: AppContext, intervalMs = 30_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const locked = await ctx.redis.set(LOCK_KEY, '1', 'PX', intervalMs, 'NX');
      if (locked === 'OK') await runScheduledTasks(ctx);
    } catch (err) {
      ctx.log.error({ err }, 'Планировщик не запустился');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
