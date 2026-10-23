import {
  ACHIEVEMENT_IDS,
  earnedAchievements,
  largestSeries,
  type AchievementId,
  type AchievementsDto,
} from '@nomer/shared';
import type { AppContext } from '../context';
import { garageCarOf, loadGarages } from '../lib/cars';
import type { Tx } from '../lib/db';
import { AppError } from '../lib/errors';

/** Выдаёт ачивку один раз; повторная выдача ничего не меняет. */
export async function grantAchievement(tx: Tx | AppContext['prisma'], userId: string, id: AchievementId, at: Date) {
  await tx.$executeRaw`
    INSERT INTO "UserAchievement" ("userId", "achievementId", "earnedAt")
    VALUES (${userId}, ${id}, ${at})
    ON CONFLICT DO NOTHING`;
}

/**
 * Пересчитывает ачивки по текущему состоянию игрока и выдаёт новые.
 * Полученная ачивка остаётся навсегда, даже если условие перестало выполняться.
 */
export async function syncAchievements(ctx: AppContext, userId: string): Promise<AchievementsDto> {
  const now = ctx.now();
  const [platesOwned, carsOwned, raceWins, sevens, exhibitionTop10, auctionsWon, garages, had] = await Promise.all([
    ctx.prisma.plate.count({ where: { ownerId: userId } }),
    ctx.prisma.userCar.count({ where: { ownerId: userId } }),
    ctx.prisma.race.count({ where: { winnerUserId: userId } }),
    ctx.prisma.plate.count({ where: { ownerId: userId, number: 777 } }),
    ctx.prisma.exhibitionEntry.count({ where: { userId, place: { lte: 10 } } }),
    ctx.prisma.auction.count({ where: { leaderId: userId, status: 'settled' } }),
    loadGarages(ctx.prisma, [userId]),
    ctx.prisma.userAchievement.findMany({ where: { userId } }),
  ]);
  const earned = earnedAchievements({
    platesOwned,
    carsOwned,
    raceWins,
    ownsTripleSeven: sevens > 0,
    hadMesalliance: had.some((a) => a.achievementId === 'mesalliance'),
    maxSeries: largestSeries(garages.get(userId)!.map(garageCarOf)),
    exhibitionTop10,
    auctionsWon,
  });
  const known = new Map(had.map((a) => [a.achievementId, a.earnedAt]));
  for (const id of earned) {
    if (!known.has(id)) {
      await grantAchievement(ctx.prisma, userId, id, now);
      known.set(id, now);
    }
  }
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { title: true } });
  return {
    achievements: ACHIEVEMENT_IDS.map((id) => ({ id, earnedAt: known.get(id)?.toISOString() ?? null })),
    title: (user.title as AchievementId | null) ?? null,
  };
}

/** Выбрать титул в профиле — только из полученных ачивок; null — снять. */
export async function setTitle(ctx: AppContext, userId: string, title: AchievementId | null) {
  if (title !== null) {
    const has = await ctx.prisma.userAchievement.findUnique({
      where: { userId_achievementId: { userId, achievementId: title } },
    });
    if (!has) throw new AppError(403, 'forbidden', 'Этот титул ещё не получен');
  }
  await ctx.prisma.user.update({ where: { id: userId }, data: { title } });
  return { title };
}
