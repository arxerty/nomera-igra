import type { Prisma, Race, User } from '@prisma/client';
import {
  canMatch,
  carModelTitle,
  effectiveStats,
  gameDayKey,
  gameWeekKey,
  isValidRaceBet,
  matchmakingGap,
  raceBetSettlement,
  raceRating,
  racesLeftToday,
  resolveRace,
  stockTuning,
  type GameConfig,
  type RaceDto,
  type RaceQueueDto,
  type RacerDto,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { CAR_INCLUDE, assertCarIdle, garageCarOf, lockOwnedCar, modelFromRow, parseTuning, type CarRow } from '../lib/cars';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, plateDto, userPublic } from '../lib/dto';
import { AppError, badRequest } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { cryptoRng } from '../lib/rng';
import { trackQuest } from './quests';
import { collectFinishedTrips } from './trips';

/** Снимок участника заезда, хранится в Race.racerA/racerB. */
interface RacerSnapshot extends Omit<RacerDto, 'user' | 'timeMs'> {
  userId: string | null;
  carId: string | null;
  timeMs: number;
}

/** Характеристики машины с тюнингом. */
function statsOf(car: CarRow, config: GameConfig) {
  return effectiveStats(modelFromRow(car.model), parseTuning(car.tuning), config.cars.tuning);
}

function snapshotOf(car: CarRow, config: GameConfig): Omit<RacerSnapshot, 'timeMs'> {
  const stats = statsOf(car, config);
  return {
    userId: car.ownerId,
    carId: car.id,
    modelId: car.modelId,
    title: carModelTitle(modelFromRow(car.model)),
    carClass: car.model.class,
    tuning: garageCarOf(car).tuning,
    plate: car.plate ? plateDto(car.plate) : null,
    rating: Math.round(raceRating(stats, config.races) * 10) / 10,
  };
}

const waitSeconds = (since: Date, now: Date) => Math.max(0, (now.getTime() - since.getTime()) / 1000);

async function racesToday(db: Tx | AppContext['prisma'], userId: string, dayKey: string): Promise<number> {
  return db.race.count({ where: { dayKey, OR: [{ userAId: userId }, { userBId: userId }] } });
}

function raceDto(race: Race, viewerId: string, users: Map<string, User | Pick<User, keyof typeof PUBLIC_USER_SELECT>>): RaceDto {
  const a = race.racerA as unknown as RacerSnapshot;
  const b = race.racerB as unknown as RacerSnapshot;
  const iAmA = race.userAId === viewerId;
  const [me, opp] = iAmA ? [a, b] : [b, a];
  const mySide = iAmA ? 'a' : 'b';
  const toDto = (r: RacerSnapshot): RacerDto => {
    const { userId, carId: _carId, ...rest } = r;
    const u = userId ? users.get(userId) : undefined;
    return { ...rest, user: u ? userPublic(u) : null };
  };
  const won = race.winnerSide === mySide;
  const payout = won && race.bet > 0 ? race.bet * 2 - race.fee : 0;
  return {
    id: race.id,
    createdAt: race.createdAt.toISOString(),
    me: toDto(me),
    opponent: toDto(opp),
    won,
    bet: race.userBId ? race.bet : 0,
    payout,
  };
}

async function raceDtoFor(db: Tx | AppContext['prisma'], race: Race, viewerId: string): Promise<RaceDto> {
  const ids = [race.userAId, race.userBId].filter((x): x is string => x !== null);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_SELECT });
  return raceDto(race, viewerId, new Map(users.map((u) => [u.id, u])));
}

/**
 * Записывает заезд и рассчитывает ставки. Ставки обоих уже списаны при входе в очередь.
 * Против «призрака» ставки нет (вызывающий её вернул).
 */
type DriveStats = { speed: number; acceleration: number; handling: number };

async function recordRace(
  tx: Tx,
  config: GameConfig,
  args: {
    a: Omit<RacerSnapshot, 'timeMs'>;
    statsA: DriveStats;
    b: Omit<RacerSnapshot, 'timeMs'>;
    statsB: DriveStats;
    bet: number;
    now: Date;
  },
): Promise<Race> {
  const { a, b, bet, now } = args;
  const result = resolveRace(args.statsA, args.statsB, cryptoRng, config.races);
  const winner = result.winner === 'a' ? a : b;
  const loser = result.winner === 'a' ? b : a;
  const ghost = b.userId === null;
  const { fee, winnerReceives } = raceBetSettlement(ghost ? 0 : bet, config.races.betFeePercent);

  const race = await tx.race.create({
    data: {
      dayKey: gameDayKey(now, config.economy.dayOffsetHours),
      weekKey: gameWeekKey(now, config.economy.dayOffsetHours),
      userAId: a.userId!,
      carAId: a.carId!,
      userBId: b.userId,
      carBId: b.carId,
      racerA: { ...a, timeMs: result.timeA } as unknown as Prisma.InputJsonValue,
      racerB: { ...b, timeMs: result.timeB } as unknown as Prisma.InputJsonValue,
      winnerSide: result.winner,
      winnerUserId: winner.userId,
      bet: ghost ? 0 : bet,
      fee,
      createdAt: now,
    },
  });
  if (winner.userId && winnerReceives > 0) {
    await changeBalance(tx, { userId: winner.userId, currency: 'chips', delta: winnerReceives, reason: 'race_win', refId: race.id });
  }
  if (winner.userId) await trackQuest(tx, config, winner.userId, 'race_win', { at: now, carClass: winner.carClass });
  if (loser.userId) await trackQuest(tx, config, loser.userId, 'race_loss', { at: now });
  return race;
}

/**
 * Встать в очередь дрэга. Если в очереди уже ждёт подходящий соперник с той же ставкой,
 * заезд проходит сразу; иначе игрок ждёт (ставка списана и вернётся при отмене).
 */
export async function enterRaceQueue(ctx: AppContext, userId: string, carId: string, bet: number): Promise<RaceQueueDto> {
  const { config } = await ctx.config.get();
  if (!isValidRaceBet(bet, config.races)) {
    throw badRequest(`Ставка: 0 или от ${config.races.minBet} до ${config.races.maxBet} Фишек`);
  }
  const now = ctx.now();
  const dayKey = gameDayKey(now, config.economy.dayOffsetHours);
  const ttlMs = config.races.matchmaking.queueTtlSeconds * 1000;

  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    if (racesLeftToday(await racesToday(tx, userId, dayKey), config.races) === 0) {
      throw new AppError(409, 'race_limit', `Не больше ${config.races.dailyLimit} гонок в сутки`);
    }
    if (await tx.raceQueueEntry.findUnique({ where: { userId } })) {
      throw new AppError(409, 'already_in_queue', 'Вы уже ждёте соперника');
    }
    await collectFinishedTrips(tx, { carIds: [carId] }, now);
    const car = await lockOwnedCar(tx, carId, userId);
    assertCarIdle(car, now);
    const me = snapshotOf(car, config);
    const myStats = statsOf(car, config);

    if (bet > 0) await changeBalance(tx, { userId, currency: 'chips', delta: -bet, reason: 'race_bet', refId: carId });

    // Ждущие с той же ставкой; занятые другой транзакцией пропускаем.
    const waiting = await tx.$queryRaw<{ id: string; userId: string; carId: string; rating: number; createdAt: Date }[]>`
      SELECT id, "userId", "carId", rating, "createdAt" FROM "RaceQueueEntry"
      WHERE bet = ${bet} AND "userId" <> ${userId} AND "createdAt" > ${new Date(now.getTime() - ttlMs)}
      ORDER BY "createdAt" LIMIT 50 FOR UPDATE SKIP LOCKED`;
    const opponent = waiting.find((w) => canMatch(me.rating, w.rating, waitSeconds(w.createdAt, now), config.races));

    if (!opponent) {
      await tx.raceQueueEntry.create({ data: { userId, carId, bet, rating: me.rating, createdAt: now } });
      return { race: null, opponentUser: null };
    }

    await tx.raceQueueEntry.delete({ where: { id: opponent.id } });
    // Машина в очереди занята, поэтому её владелец и состояние не могли поменяться.
    const oppCar = await tx.userCar.findUniqueOrThrow({ where: { id: opponent.carId }, include: CAR_INCLUDE });
    const them = snapshotOf(oppCar, config);
    const themStats = statsOf(oppCar, config);
    // Сторона A — ждавший соперник, B — пришедший: порядок не влияет на исход.
    const race = await recordRace(tx, config, { a: them, statsA: themStats, b: me, statsB: myStats, bet, now });
    const opponentUser = await tx.user.findUniqueOrThrow({ where: { id: opponent.userId } });
    return { race, opponentUser };
  });

  if (result.race && result.opponentUser) {
    const race = result.race;
    const me = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const week = race.weekKey;
    const theirDto = await raceDtoFor(ctx.prisma, race, result.opponentUser.id);
    await afterCommit(
      ctx,
      race.winnerUserId ? ctx.leaderboard.addRaceWin(race.winnerUserId, week) : Promise.resolve(),
      ctx.notifier.send(result.opponentUser, {
        type: 'race_finished',
        won: theirDto.won,
        opponent: me.firstName,
        payout: theirDto.payout,
      }),
    );
  }
  return getRaceQueue(ctx, userId);
}

export async function getRaceQueue(ctx: AppContext, userId: string): Promise<RaceQueueDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const dayKey = gameDayKey(now, config.economy.dayOffsetHours);
  const [entry, last, used] = await Promise.all([
    ctx.prisma.raceQueueEntry.findUnique({ where: { userId } }),
    ctx.prisma.race.findFirst({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { createdAt: 'desc' },
    }),
    racesToday(ctx.prisma, userId, dayKey),
  ]);
  return {
    status: entry ? 'waiting' : 'idle',
    entry: entry
      ? {
          carId: entry.carId,
          bet: entry.bet,
          since: entry.createdAt.toISOString(),
          gap: matchmakingGap(waitSeconds(entry.createdAt, now), config.races),
        }
      : null,
    lastRace: last ? await raceDtoFor(ctx.prisma, last, userId) : null,
    racesLeft: racesLeftToday(used, config.races),
  };
}

async function removeEntry(tx: Tx, userId: string): Promise<{ carId: string; bet: number; rating: number; createdAt: Date } | null> {
  const rows = await tx.$queryRaw<{ id: string; carId: string; bet: number; rating: number; createdAt: Date }[]>`
    SELECT id, "carId", bet, rating, "createdAt" FROM "RaceQueueEntry" WHERE "userId" = ${userId} FOR UPDATE`;
  const entry = rows[0];
  if (!entry) return null;
  await tx.raceQueueEntry.delete({ where: { id: entry.id } });
  if (entry.bet > 0) {
    await changeBalance(tx, { userId, currency: 'chips', delta: entry.bet, reason: 'race_refund', refId: entry.carId });
  }
  return entry;
}

/** Выйти из очереди: ставка возвращается. */
export async function leaveRaceQueue(ctx: AppContext, userId: string): Promise<RaceQueueDto> {
  await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    await removeEntry(tx, userId);
  });
  return getRaceQueue(ctx, userId);
}

/**
 * Проверка очереди клиентом. Если живой соперник так и не нашёлся за ghostAfterSeconds,
 * игрок едет против «призрака» — заводской модели близкого рейтинга, без ставки.
 */
export async function pollRaceQueue(ctx: AppContext, userId: string): Promise<RaceQueueDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const mm = config.races.matchmaking;

  const raced = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const entry = await tx.raceQueueEntry.findUnique({ where: { userId } });
    if (!entry) return null;
    const waited = waitSeconds(entry.createdAt, now);
    if (waited >= mm.queueTtlSeconds) {
      await removeEntry(tx, userId);
      return null;
    }
    if (waited < mm.ghostAfterSeconds) return null;

    await removeEntry(tx, userId);
    const car = await lockOwnedCar(tx, entry.carId, userId);
    const me = snapshotOf(car, config);
    const myStats = statsOf(car, config);
    const models = await tx.carModel.findMany({ where: { retired: false } });
    const gap = matchmakingGap(waited, config.races);
    const scored = models.map((m) => ({ m, rating: raceRating(modelFromRow(m).stats, config.races) }));
    const near = scored.filter((s) => Math.abs(s.rating - me.rating) <= gap);
    const pool = near.length ? near : [...scored].sort((x, y) => Math.abs(x.rating - me.rating) - Math.abs(y.rating - me.rating)).slice(0, 1);
    const pick = pool[cryptoRng.int(pool.length)]!;
    const ghostModel = modelFromRow(pick.m);
    const ghost: Omit<RacerSnapshot, 'timeMs'> = {
      userId: null,
      carId: null,
      modelId: ghostModel.id,
      title: carModelTitle(ghostModel),
      carClass: ghostModel.class,
      tuning: stockTuning(config.cars.tuning.palette[cryptoRng.int(config.cars.tuning.palette.length)]!),
      plate: null,
      rating: Math.round(pick.rating * 10) / 10,
    };
    return recordRace(tx, config, { a: me, statsA: myStats, b: ghost, statsB: ghostModel.stats, bet: 0, now });
  });

  if (raced?.winnerUserId) await afterCommit(ctx, ctx.leaderboard.addRaceWin(raced.winnerUserId, raced.weekKey));
  return getRaceQueue(ctx, userId);
}

export async function raceHistory(ctx: AppContext, userId: string, limit: number): Promise<RaceDto[]> {
  const races = await ctx.prisma.race.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const ids = [...new Set(races.flatMap((r) => [r.userAId, r.userBId]).filter((x): x is string => x !== null))];
  const users = await ctx.prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_SELECT });
  const byId = new Map(users.map((u) => [u.id, u]));
  return races.map((r) => raceDto(r, userId, byId));
}

/** Заявки старше срока жизни снимаются, ставки возвращаются (вызывается планировщиком). */
export async function expireRaceQueue(ctx: AppContext): Promise<number> {
  const { config } = await ctx.config.get();
  const cutoff = new Date(ctx.now().getTime() - config.races.matchmaking.queueTtlSeconds * 1000);
  const stale = await ctx.prisma.raceQueueEntry.findMany({ where: { createdAt: { lte: cutoff } }, select: { userId: true } });
  for (const { userId } of stale) {
    await withTx(ctx.prisma, async (tx) => {
      await lockUsers(tx, [userId]);
      await removeEntry(tx, userId);
    });
  }
  return stale.length;
}
