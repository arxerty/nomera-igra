import type { User } from '@prisma/client';
import { z } from 'zod';
import {
  LEADERBOARDS,
  type LeaderboardBoard,
  type LeaderboardDto,
  type ProfileDto,
} from '@nomer/shared';
import { miniAppLink, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING } from '../lib/db';
import { PUBLIC_USER_SELECT, plateDto, settingsDto, userPublic } from '../lib/dto';
import { garageSummary } from './garage';
import { leaderboardPeriod, type LeaderboardPeriod } from './leaderboard';

export const settingsSchema = z
  .object({
    locale: z.enum(['ru', 'en']),
    soundEnabled: z.boolean(),
    hapticsEnabled: z.boolean(),
    notificationsEnabled: z.boolean(),
  })
  .partial();

export async function updateSettings(ctx: AppContext, userId: string, input: z.infer<typeof settingsSchema>) {
  const user = await ctx.prisma.user.update({ where: { id: userId }, data: input });
  return settingsDto(user);
}

async function currentPeriod(ctx: AppContext): Promise<LeaderboardPeriod> {
  const { config } = await ctx.config.get();
  return leaderboardPeriod(ctx.now(), config.economy.dayOffsetHours);
}

export async function getProfile(ctx: AppContext, user: User): Promise<ProfileDto> {
  const period = await currentPeriod(ctx);
  const [summary, best, referrals, collection, ...ranks] = await Promise.all([
    garageSummary(ctx, user.id),
    ctx.prisma.plate.findFirst({
      where: { ownerId: user.id },
      orderBy: [{ value: 'desc' }, { acquiredAt: 'asc' }],
      include: WITH_ACTIVE_LISTING,
    }),
    ctx.prisma.user.count({ where: { referredById: user.id } }),
    ctx.leaderboard.rankOf('value', period, user.id),
    ...LEADERBOARDS.map((b) => ctx.leaderboard.rankOf(b, period, user.id)),
  ]);

  return {
    user: userPublic(user),
    memberSince: user.createdAt.toISOString(),
    stats: {
      totalRolls: user.totalRolls,
      platesOwned: summary.total,
      // Номера не на машинах + машины с номерами и комбо — то же, что в рейтинге.
      collectionValue: collection.score,
      byTier: summary.byTier,
      bestPlate: best ? plateDto(best) : null,
      referrals,
    },
    ranks: Object.fromEntries(LEADERBOARDS.map((b, i) => [b, ranks[i]!.rank])) as Record<LeaderboardBoard, number | null>,
    referralLink: miniAppLink(ctx, `ref_${user.telegramId}`),
    settings: settingsDto(user),
  };
}

export async function getLeaderboard(
  ctx: AppContext,
  userId: string,
  board: LeaderboardBoard,
  limit: number,
): Promise<LeaderboardDto> {
  const period = await currentPeriod(ctx);
  const [top, me] = await Promise.all([
    ctx.leaderboard.top(board, period, limit),
    ctx.leaderboard.rankOf(board, period, userId),
  ]);
  const users = await ctx.prisma.user.findMany({
    where: { id: { in: top.map((t) => t.id) } },
    select: PUBLIC_USER_SELECT,
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    board,
    entries: top
      .filter((t) => byId.has(t.id))
      .map((t, i) => ({ rank: i + 1, user: userPublic(byId.get(t.id)!), score: t.score })),
    me,
  };
}
