import { z } from 'zod';
import { classifyPlate, gameSeasonStart, gameWeekStart, plateValue, type GameConfig } from '@nomer/shared';
import type { AppContext } from '../context';
import { leaderboardPeriod } from './leaderboard';
import { withTx } from '../lib/db';
import { notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Частичная правка конфига: секции верхнего уровня (odds, rarity, regions, prices, …)
 * сливаются с текущими на один уровень вглубь, массивы заменяются целиком.
 * Например, `{ rarity: { vipSeries: [...] } }` меняет только VIP-серии.
 */
export function mergeConfigPatch(current: GameConfig, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const cur = (current as Record<string, unknown>)[key];
    merged[key] = isPlainObject(cur) && isPlainObject(value) ? { ...cur, ...value } : value;
  }
  return merged;
}

export async function patchConfig(ctx: AppContext, adminTelegramId: bigint, patch: unknown) {
  const { config } = await ctx.config.get();
  return ctx.config.save(mergeConfigPatch(config, patch), adminTelegramId);
}

/**
 * Пересчитывает тир и ценность всех номеров по текущему конфигу
 * (после правки VIP-серий, столичных регионов или цен) и пересобирает рейтинги.
 */
export async function recomputePlates(ctx: AppContext) {
  const { config } = await ctx.config.get();
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;

  for (;;) {
    const batch = await ctx.prisma.plate.findMany({
      take: 1000,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    for (const p of batch) {
      const rarity = classifyPlate({ letters: p.letters, number: p.number, region: p.region }, config.rarity);
      const value = plateValue(rarity, config.prices);
      const same =
        p.tier === rarity.tier &&
        p.value === value &&
        p.traits.join() === rarity.traits.join() &&
        p.bonuses.join() === rarity.bonuses.join();
      if (!same) {
        await ctx.prisma.plate.update({
          where: { id: p.id },
          data: { tier: rarity.tier, value, traits: rarity.traits, bonuses: rarity.bonuses },
        });
        changed++;
      }
    }
    scanned += batch.length;
    cursor = batch.at(-1)!.id;
  }

  await rebuildLeaderboards(ctx);
  return { scanned, changed };
}

/** Пересборка всех рейтингов из БД. */
export async function rebuildLeaderboards(ctx: AppContext) {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const offset = config.economy.dayOffsetHours;
  await ctx.leaderboard.rebuild(leaderboardPeriod(now, offset), gameWeekStart(now, offset), gameSeasonStart(now, offset));
}

export const auditQuerySchema = z.object({
  kind: z.enum(['rolls', 'deals', 'ledger', 'payments']),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

async function findUserByTelegramId(ctx: AppContext, telegramId: string) {
  const user = await ctx.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) throw notFound('Пользователь не найден');
  return user;
}

export async function getUserForAdmin(ctx: AppContext, telegramId: string) {
  const user = await findUserByTelegramId(ctx, telegramId);
  const plates = await ctx.prisma.plate.count({ where: { ownerId: user.id } });
  return { ...user, telegramId: user.telegramId.toString(), plates };
}

/** Журналы пользователя для разбора жалоб. */
export async function auditUser(ctx: AppContext, telegramId: string, q: z.infer<typeof auditQuerySchema>) {
  const user = await findUserByTelegramId(ctx, telegramId);
  const take = q.limit;
  const orderBy = { createdAt: 'desc' as const };
  switch (q.kind) {
    case 'rolls':
      return ctx.prisma.rollLog.findMany({ where: { userId: user.id }, orderBy, take });
    case 'deals':
      return ctx.prisma.dealLog.findMany({
        where: { OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
        orderBy,
        take,
      });
    case 'ledger':
      return ctx.prisma.ledgerEntry.findMany({ where: { userId: user.id }, orderBy, take });
    case 'payments':
      return ctx.prisma.payment.findMany({ where: { userId: user.id }, orderBy, take });
  }
}

export const adjustSchema = z.object({
  currency: z.enum(['chips', 'rolls']),
  delta: z.number().int().refine((d) => d !== 0, 'delta не может быть 0'),
  note: z.string().trim().min(3).max(500),
});

/** Ручная корректировка баланса (компенсации по жалобам). Пишется в журнал с комментарием. */
export async function adjustBalance(
  ctx: AppContext,
  adminTelegramId: bigint,
  telegramId: string,
  input: z.infer<typeof adjustSchema>,
) {
  const user = await findUserByTelegramId(ctx, telegramId);
  const balance = await withTx(ctx.prisma, (tx) =>
    changeBalance(tx, {
      userId: user.id,
      currency: input.currency,
      delta: input.delta,
      reason: 'admin_adjust',
      refId: `admin:${adminTelegramId}`,
      note: input.note,
    }),
  );
  return { balance };
}
