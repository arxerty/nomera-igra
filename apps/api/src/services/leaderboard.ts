import { Prisma, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { gameSeasonKey, gameWeekKey, type GameConfig, type LeaderboardBoard } from '@nomer/shared';
import { collectionValues } from '../lib/cars';

const KEYS = {
  value: 'lb:value',
  legendary: 'lb:legendary',
  weekly: (week: string) => `lb:weekly:${week}`,
  season: (season: string) => `lb:season:${season}`,
  races: (week: string) => `lb:races:${week}`,
  clubs: 'lb:clubs',
};
const WEEKLY_TTL_SEC = 60 * 60 * 24 * 35;
const SEASON_TTL_SEC = 60 * 60 * 24 * 400;

/** Период рейтингов: игровая неделя и сезон (месяц). */
export interface LeaderboardPeriod {
  week: string;
  season: string;
}

export function leaderboardPeriod(at: Date, offsetHours: number): LeaderboardPeriod {
  return { week: gameWeekKey(at, offsetHours), season: gameSeasonKey(at, offsetHours) };
}

/**
 * Рейтинги в Redis ZSET:
 * - value — стоимость коллекции: номера не на машинах + машины с номерами и комбо;
 * - legendary — число легендарных и мифических номеров;
 * - weekly / season — ценность номеров, выбитых за игровую неделю / сезон;
 * - races — победы в гонках за неделю (недельный турнир);
 * - clubs — сумма value участников клуба.
 * value, legendary и clubs всегда пересчитываются из БД для затронутых игроков, поэтому не расходятся с ней.
 */
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly getConfig: () => Promise<GameConfig>,
  ) {}

  private key(board: LeaderboardBoard, period: LeaderboardPeriod): string {
    switch (board) {
      case 'value':
      case 'legendary':
        return KEYS[board];
      case 'weekly':
        return KEYS.weekly(period.week);
      case 'season':
        return KEYS.season(period.season);
      case 'races':
        return KEYS.races(period.week);
    }
  }

  async refreshUsers(userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    const config = await this.getConfig();
    const [values, legendaryRows] = await Promise.all([
      collectionValues(this.prisma, config, ids),
      this.prisma.$queryRaw<{ ownerId: string; legendary: bigint }[]>`
        SELECT "ownerId", COUNT(*)::bigint AS legendary
        FROM "Plate" WHERE "ownerId" IN (${Prisma.join(ids)}) AND tier IN ('legendary', 'mythic')
        GROUP BY "ownerId"`,
    ]);
    const legendaryBy = new Map(legendaryRows.map((r) => [r.ownerId, Number(r.legendary)]));

    const pipe = this.redis.pipeline();
    for (const id of ids) {
      const value = values.get(id) ?? 0;
      const legendary = legendaryBy.get(id) ?? 0;
      if (value > 0) pipe.zadd(KEYS.value, value, id);
      else pipe.zrem(KEYS.value, id);
      if (legendary > 0) pipe.zadd(KEYS.legendary, legendary, id);
      else pipe.zrem(KEYS.legendary, id);
    }
    await pipe.exec();

    const clubs = await this.prisma.clubMember.findMany({ where: { userId: { in: ids } }, select: { clubId: true } });
    await this.refreshClubs(clubs.map((c) => c.clubId));
  }

  /** Пересчитывает рейтинг клубов из value их участников. */
  async refreshClubs(clubIds: string[]): Promise<void> {
    const ids = [...new Set(clubIds)];
    if (ids.length === 0) return;
    const members = await this.prisma.clubMember.findMany({ where: { clubId: { in: ids } } });
    const scores = members.length ? await this.redis.zmscore(KEYS.value, ...members.map((m) => m.userId)) : [];
    const sum = new Map(ids.map((id) => [id, 0]));
    members.forEach((m, i) => sum.set(m.clubId, sum.get(m.clubId)! + Number(scores[i] ?? 0)));
    const pipe = this.redis.pipeline();
    for (const [clubId, score] of sum) {
      if (members.some((m) => m.clubId === clubId)) pipe.zadd(KEYS.clubs, score, clubId);
      else pipe.zrem(KEYS.clubs, clubId);
    }
    await pipe.exec();
  }

  async scoresOf(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const scores = await this.redis.zmscore(KEYS.value, ...userIds);
    return new Map(userIds.map((id, i) => [id, Number(scores[i] ?? 0)]));
  }

  async addRollValue(userId: string, value: number, period: LeaderboardPeriod): Promise<void> {
    const week = KEYS.weekly(period.week);
    const season = KEYS.season(period.season);
    await this.redis
      .pipeline()
      .zincrby(week, value, userId)
      .expire(week, WEEKLY_TTL_SEC)
      .zincrby(season, value, userId)
      .expire(season, SEASON_TTL_SEC)
      .exec();
  }

  async addRaceWin(userId: string, week: string): Promise<void> {
    const key = KEYS.races(week);
    await this.redis.pipeline().zincrby(key, 1, userId).expire(key, WEEKLY_TTL_SEC).exec();
  }

  async top(board: LeaderboardBoard, period: LeaderboardPeriod, limit: number) {
    return this.topOf(this.key(board, period), limit);
  }

  async topClubs(limit: number) {
    return this.topOf(KEYS.clubs, limit);
  }

  private async topOf(key: string, limit: number): Promise<{ id: string; score: number }[]> {
    const flat = await this.redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
    const result: { id: string; score: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) result.push({ id: flat[i]!, score: Number(flat[i + 1]) });
    return result;
  }

  async rankOf(board: LeaderboardBoard, period: LeaderboardPeriod, userId: string) {
    return this.rankIn(this.key(board, period), userId);
  }

  async clubRank(clubId: string) {
    return this.rankIn(KEYS.clubs, clubId);
  }

  private async rankIn(key: string, member: string): Promise<{ rank: number | null; score: number }> {
    const [rank, score] = await Promise.all([this.redis.zrevrank(key, member), this.redis.zscore(key, member)]);
    return { rank: rank === null ? null : rank + 1, score: score === null ? 0 : Number(score) };
  }

  /** Полная пересборка из БД: при старте с пустым Redis и после пересчёта редкости. */
  async rebuild(period: LeaderboardPeriod, weekStart: Date, seasonStart: Date): Promise<void> {
    const [plateOwners, carOwners] = await Promise.all([
      this.prisma.plate.findMany({ where: { ownerId: { not: null } }, distinct: ['ownerId'], select: { ownerId: true } }),
      this.prisma.userCar.findMany({ where: { ownerId: { not: null } }, distinct: ['ownerId'], select: { ownerId: true } }),
    ]);
    await this.redis.del(
      KEYS.value,
      KEYS.legendary,
      KEYS.clubs,
      KEYS.weekly(period.week),
      KEYS.season(period.season),
      KEYS.races(period.week),
    );
    const ids = [...new Set([...plateOwners, ...carOwners].map((o) => o.ownerId!))];
    for (let i = 0; i < ids.length; i += 500) await this.refreshUsers(ids.slice(i, i + 500));

    const [weekly, season, wins] = await Promise.all([
      this.prisma.rollLog.groupBy({ by: ['userId'], where: { createdAt: { gte: weekStart } }, _sum: { value: true } }),
      this.prisma.rollLog.groupBy({ by: ['userId'], where: { createdAt: { gte: seasonStart } }, _sum: { value: true } }),
      this.prisma.race.groupBy({
        by: ['winnerUserId'],
        where: { weekKey: period.week, winnerUserId: { not: null } },
        _count: true,
      }),
    ]);
    const pipe = this.redis.pipeline();
    for (const w of weekly) pipe.zadd(KEYS.weekly(period.week), w._sum.value ?? 0, w.userId);
    for (const s of season) pipe.zadd(KEYS.season(period.season), s._sum.value ?? 0, s.userId);
    for (const r of wins) pipe.zadd(KEYS.races(period.week), r._count, r.winnerUserId!);
    pipe.expire(KEYS.weekly(period.week), WEEKLY_TTL_SEC);
    pipe.expire(KEYS.season(period.season), SEASON_TTL_SEC);
    pipe.expire(KEYS.races(period.week), WEEKLY_TTL_SEC);
    await pipe.exec();

    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    await this.refreshClubs(clubs.map((c) => c.id));
  }

  async isEmpty(): Promise<boolean> {
    return (await this.redis.exists(KEYS.value)) === 0;
  }
}
