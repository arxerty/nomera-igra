import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  TIERS,
  isValidRegionCode,
  type GarageSummaryDto,
  type Page,
  type PlateCardDto,
  type PlateDto,
  type Tier,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING, assertPlateFree, lockOwnedPlate, lockUsers, withTx } from '../lib/db';
import { PUBLIC_USER_SELECT, plateDto, userPublic } from '../lib/dto';
import { notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { trackQuest } from './quests';

export const garageQuerySchema = z.object({
  tier: z.enum(TIERS).optional(),
  region: z.string().refine(isValidRegionCode).optional(),
  sort: z.enum(['newest', 'oldest', 'value_desc', 'value_asc', 'tier_desc']).default('newest'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type GarageQuery = z.infer<typeof garageQuerySchema>;

const ORDER: Record<GarageQuery['sort'], Prisma.PlateOrderByWithRelationInput[]> = {
  newest: [{ acquiredAt: 'desc' }, { id: 'desc' }],
  oldest: [{ acquiredAt: 'asc' }, { id: 'asc' }],
  value_desc: [{ value: 'desc' }, { id: 'desc' }],
  value_asc: [{ value: 'asc' }, { id: 'asc' }],
  tier_desc: [{ tier: 'desc' }, { value: 'desc' }, { id: 'desc' }],
};

export async function listGarage(ctx: AppContext, ownerId: string, q: GarageQuery): Promise<Page<PlateDto>> {
  const rows = await ctx.prisma.plate.findMany({
    where: { ownerId, tier: q.tier, region: q.region },
    orderBy: ORDER[q.sort],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: WITH_ACTIVE_LISTING,
  });
  const items = rows.slice(0, q.limit);
  return { items: items.map(plateDto), nextCursor: rows.length > q.limit ? items.at(-1)!.id : null };
}

export async function garageSummary(ctx: AppContext, ownerId: string): Promise<GarageSummaryDto> {
  const [byTier, regions] = await Promise.all([
    ctx.prisma.plate.groupBy({ by: ['tier'], where: { ownerId }, _count: true, _sum: { value: true } }),
    ctx.prisma.plate.findMany({ where: { ownerId }, distinct: ['region'], select: { region: true } }),
  ]);
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  let total = 0;
  let value = 0;
  for (const row of byTier) {
    counts[row.tier] = row._count;
    total += row._count;
    value += row._sum.value ?? 0;
  }
  return {
    total,
    value,
    byTier: counts,
    regions: regions.map((r) => r.region).sort((a, b) => Number(a) - Number(b)),
  };
}

/** Карточка номера с паспортом. Доступна любому игроку — номера публичны. */
export async function plateCard(ctx: AppContext, idOrKey: string): Promise<PlateCardDto> {
  const plate = await ctx.prisma.plate.findFirst({
    where: { OR: [{ id: idOrKey }, { key: idOrKey }] },
    include: {
      ...WITH_ACTIVE_LISTING,
      owner: { select: PUBLIC_USER_SELECT },
      ownerships: {
        orderBy: { acquiredAt: 'desc' },
        take: 50,
        include: { user: { select: PUBLIC_USER_SELECT } },
      },
    },
  });
  if (!plate) throw notFound('Номер не найден');
  const record = await ctx.prisma.plateOwnership.aggregate({ where: { plateId: plate.id }, _max: { acquiredPrice: true } });
  return {
    recordPrice: record._max.acquiredPrice,
    plate: plateDto(plate),
    owner: plate.owner ? userPublic(plate.owner) : null,
    firstRolledAt: plate.firstRolledAt.toISOString(),
    rolledTimes: plate.rolledTimes,
    passport: plate.ownerships.map((o) => ({
      owner: userPublic(o.user),
      acquiredAt: o.acquiredAt.toISOString(),
      acquiredVia: o.acquiredVia,
      acquiredPrice: o.acquiredPrice,
      releasedAt: o.releasedAt?.toISOString() ?? null,
    })),
  };
}

/** Продажа системе: номер возвращается в пул и может выпасть снова. */
export async function sellToSystem(ctx: AppContext, userId: string, plateId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();

  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const plate = await lockOwnedPlate(tx, plateId, userId);
    assertPlateFree(plate);

    const chips = await changeBalance(tx, {
      userId,
      currency: 'chips',
      delta: plate.value,
      reason: 'system_sell',
      refId: plate.id,
    });
    await tx.plateOwnership.updateMany({
      where: { plateId, userId, releasedAt: null },
      data: { releasedAt: now, releasedVia: 'system_sell', releasedPrice: plate.value },
    });
    await tx.plate.update({ where: { id: plateId }, data: { ownerId: null, acquiredAt: null } });
    await tx.dealLog.create({
      data: { type: 'system_sell', plateKeys: [plate.key], fromUserId: userId, price: plate.value, refId: plate.id },
    });
    await trackQuest(tx, config, userId, 'sell_system', { at: now, tier: plate.tier });
    return { chips, received: plate.value };
  });

  await afterCommit(ctx, ctx.leaderboard.refreshUsers([userId]));
  return result;
}
