import type { Prisma, User } from '@prisma/client';
import {
  canVoteInExhibition,
  exhibitionPrize,
  exhibitionScore,
  gameDayKey,
  gameWeekKey,
  gameWeekStart,
  pickVotePair,
  rankExhibition,
  type ExhibitionDto,
  type ExhibitionEntryDto,
  type Locale,
  type VotePairDto,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { CAR_INCLUDE, carDtosFor, lockOwnedCar } from '../lib/cars';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, userPublic } from '../lib/dto';
import { AppError } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { cryptoRng } from '../lib/rng';
import { trackQuest } from './quests';

const WEEK = 7 * 86_400_000;
const PAIR_TTL_SEC = 600;
const pairRedisKey = (voterId: string) => `exh:pair:${voterId}`;

const ENTRY_INCLUDE = {
  car: { include: CAR_INCLUDE },
  user: { select: PUBLIC_USER_SELECT },
} satisfies Prisma.ExhibitionEntryInclude;
type EntryRow = Prisma.ExhibitionEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

const localeOf = (u: Pick<User, 'locale'>): Locale => (u.locale === 'en' ? 'en' : 'ru');

/** Заявка действительна, пока машина у того, кто её выставил. */
const VALID_ENTRY = { car: { ownerId: { not: null } } } satisfies Prisma.ExhibitionEntryWhereInput;
const isValid = (e: { userId: string; car: { ownerId: string | null } }) => e.car.ownerId === e.userId;

async function currentExhibition(db: Tx | AppContext['prisma'], weekKey: string) {
  return db.exhibition.upsert({ where: { weekKey }, create: { weekKey }, update: {} });
}

async function entryDtos(ctx: AppContext, rows: EntryRow[], viewer: User, places?: Map<string, number | null>) {
  const { config } = await ctx.config.get();
  const cars = await carDtosFor(ctx.prisma, rows.map((r) => r.car), config, ctx.now(), localeOf(viewer));
  return rows.map(
    (e): ExhibitionEntryDto => ({
      id: e.id,
      owner: userPublic(e.user),
      car: cars.get(e.carId)!,
      wins: e.wins,
      shows: e.shows,
      score: Math.round(exhibitionScore(e.wins, e.shows) * 1000) / 1000,
      place: places?.get(e.id) ?? e.place,
    }),
  );
}

async function topOf(ctx: AppContext, exhibitionId: string, viewer: User, settled: boolean) {
  const { config } = await ctx.config.get();
  if (settled) {
    const rows = await ctx.prisma.exhibitionEntry.findMany({
      where: { exhibitionId, place: { not: null } },
      orderBy: { place: 'asc' },
      take: 10,
      include: ENTRY_INCLUDE,
    });
    return entryDtos(ctx, rows, viewer);
  }
  const stats = await ctx.prisma.exhibitionEntry.findMany({
    where: { exhibitionId, ...VALID_ENTRY },
    select: { id: true, wins: true, shows: true, userId: true, car: { select: { ownerId: true } } },
  });
  const ranked = rankExhibition(stats.filter(isValid), config.exhibition).slice(0, 10);
  const rows = await ctx.prisma.exhibitionEntry.findMany({ where: { id: { in: ranked.map((r) => r.id) } }, include: ENTRY_INCLUDE });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return entryDtos(ctx, ranked.map((r) => byId.get(r.id)!), viewer, new Map(ranked.map((r) => [r.id, r.place])));
}

export async function getExhibition(ctx: AppContext, viewer: User): Promise<ExhibitionDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const offset = config.economy.dayOffsetHours;
  const weekKey = gameWeekKey(now, offset);
  const prevKey = gameWeekKey(new Date(now.getTime() - WEEK), offset);
  const exhibition = await currentExhibition(ctx.prisma, weekKey);
  const [mine, prev, rewardedToday, me] = await Promise.all([
    ctx.prisma.exhibitionEntry.findUnique({
      where: { exhibitionId_userId: { exhibitionId: exhibition.id, userId: viewer.id } },
      include: ENTRY_INCLUDE,
    }),
    ctx.prisma.exhibition.findUnique({ where: { weekKey: prevKey } }),
    ctx.prisma.exhibitionVote.count({ where: { voterId: viewer.id, dayKey: gameDayKey(now, offset), rewarded: true } }),
    ctx.prisma.user.findUniqueOrThrow({ where: { id: viewer.id } }),
  ]);
  return {
    weekKey,
    endsAt: new Date(gameWeekStart(now, offset).getTime() + WEEK).toISOString(),
    myEntry: mine ? (await entryDtos(ctx, [mine], viewer))[0]! : null,
    canVote: canVoteInExhibition({ createdAt: me.createdAt, rollsTotal: me.totalRolls }, now, config.exhibition),
    rewardedVotesLeft: Math.max(0, config.exhibition.maxRewardedVotesPerDay - rewardedToday),
    top: await topOf(ctx, exhibition.id, viewer, false),
    previousTop: prev ? await topOf(ctx, prev.id, viewer, prev.status === 'settled') : [],
  };
}

/** Выставить машину на выставку этой недели — одну, без замены. */
export async function enterExhibition(ctx: AppContext, viewer: User, carId: string): Promise<ExhibitionDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const weekKey = gameWeekKey(now, config.economy.dayOffsetHours);
  await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [viewer.id]);
    await lockOwnedCar(tx, carId, viewer.id);
    const exhibition = await currentExhibition(tx, weekKey);
    const existing = await tx.exhibitionEntry.findUnique({
      where: { exhibitionId_userId: { exhibitionId: exhibition.id, userId: viewer.id } },
    });
    if (existing) throw new AppError(409, 'limit_reached', 'На этой неделе вы уже выставили машину');
    await tx.exhibitionEntry.create({ data: { exhibitionId: exhibition.id, userId: viewer.id, carId } });
  });
  return getExhibition(ctx, viewer);
}

/** Пара машин «какая круче?». Выданная пара запоминается — голосовать можно только за неё. */
export async function getVotePair(ctx: AppContext, viewer: User): Promise<VotePairDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const me = await ctx.prisma.user.findUniqueOrThrow({ where: { id: viewer.id } });
  if (!canVoteInExhibition({ createdAt: me.createdAt, rollsTotal: me.totalRolls }, now, config.exhibition)) {
    throw new AppError(403, 'vote_not_allowed', 'Голосовать можно с аккаунта постарше и с прогрессом в игре');
  }
  const weekKey = gameWeekKey(now, config.economy.dayOffsetHours);
  const exhibition = await currentExhibition(ctx.prisma, weekKey);
  const entries = (
    await ctx.prisma.exhibitionEntry.findMany({
      where: { exhibitionId: exhibition.id, ...VALID_ENTRY },
      select: { id: true, wins: true, shows: true, userId: true, car: { select: { ownerId: true } } },
    })
  ).filter(isValid);
  const own = new Set(entries.filter((e) => e.userId === viewer.id).map((e) => e.id));
  const voted = new Set(
    (await ctx.prisma.exhibitionVote.findMany({ where: { exhibitionId: exhibition.id, voterId: viewer.id }, select: { pairKey: true } })).map(
      (v) => v.pairKey,
    ),
  );

  for (let attempt = 0; attempt < 8; attempt++) {
    const pair = pickVotePair(entries, own, cryptoRng);
    if (!pair) break;
    if (voted.has([...pair].sort().join(':'))) continue;
    await ctx.redis.set(pairRedisKey(viewer.id), `${exhibition.id}|${pair[0]}|${pair[1]}`, 'EX', PAIR_TTL_SEC);
    const rows = await ctx.prisma.exhibitionEntry.findMany({ where: { id: { in: pair } }, include: ENTRY_INCLUDE });
    const dtos = await entryDtos(ctx, rows, viewer);
    const byId = new Map(dtos.map((d) => [d.id, d]));
    return { pair: [byId.get(pair[0])!, byId.get(pair[1])!] };
  }
  return { pair: null };
}

/** Голос за одну из машин выданной пары. За голос — Фишки, но не больше лимита в сутки. */
export async function vote(ctx: AppContext, viewer: User, winnerEntryId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const issued = await ctx.redis.getdel(pairRedisKey(viewer.id));
  const [exhibitionId, a, b] = issued?.split('|') ?? [];
  if (!exhibitionId || !a || !b || (winnerEntryId !== a && winnerEntryId !== b)) {
    throw new AppError(409, 'vote_not_allowed', 'Эта пара уже недоступна — получите новую');
  }
  const loserEntryId = winnerEntryId === a ? b : a;
  const dayKey = gameDayKey(now, config.economy.dayOffsetHours);

  return withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [viewer.id]);
    const exhibition = await tx.exhibition.findUnique({ where: { id: exhibitionId } });
    if (!exhibition || exhibition.status !== 'open') throw new AppError(409, 'vote_not_allowed', 'Выставка уже закрыта');
    const pairKey = [a, b].sort().join(':');
    if (await tx.exhibitionVote.findUnique({ where: { exhibitionId_voterId_pairKey: { exhibitionId, voterId: viewer.id, pairKey } } })) {
      throw new AppError(409, 'vote_not_allowed', 'Вы уже голосовали за эту пару');
    }
    const rewardedToday = await tx.exhibitionVote.count({ where: { voterId: viewer.id, dayKey, rewarded: true } });
    const rewarded = rewardedToday < config.exhibition.maxRewardedVotesPerDay && config.exhibition.voteRewardChips > 0;
    await tx.exhibitionVote.create({
      data: { exhibitionId, voterId: viewer.id, pairKey, winnerEntryId, rewarded, dayKey, createdAt: now },
    });
    await tx.exhibitionEntry.update({ where: { id: winnerEntryId }, data: { wins: { increment: 1 }, shows: { increment: 1 } } });
    await tx.exhibitionEntry.update({ where: { id: loserEntryId }, data: { shows: { increment: 1 } } });
    let chips: number | null = null;
    if (rewarded) {
      chips = await changeBalance(tx, {
        userId: viewer.id,
        currency: 'chips',
        delta: config.exhibition.voteRewardChips,
        reason: 'exhibition_vote',
        refId: `${exhibitionId}:${pairKey}`,
      });
    }
    await trackQuest(tx, config, viewer.id, 'exhibition_vote', { at: now });
    return { rewarded, chips };
  });
}

/** Подводит итоги прошедших выставок: места, призы, бейджи на машины. */
export async function settleExhibitions(ctx: AppContext): Promise<number> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const currentWeek = gameWeekKey(now, config.economy.dayOffsetHours);
  const open = await ctx.prisma.exhibition.findMany({ where: { status: 'open', weekKey: { lt: currentWeek } } });

  for (const ex of open) {
    const prizes = await withTx(ctx.prisma, async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Exhibition" WHERE id = ${ex.id} AND status = 'open' FOR UPDATE`;
      if (!locked[0]) return [];
      const entries = await tx.exhibitionEntry.findMany({
        where: { exhibitionId: ex.id },
        select: { id: true, wins: true, shows: true, userId: true, car: { select: { ownerId: true } } },
      });
      const ranked = rankExhibition(entries.filter(isValid), config.exhibition);
      const awarded: { userId: string; place: number; chips: number; rolls: number }[] = [];
      for (const r of ranked) {
        if (r.place === null) continue;
        await tx.exhibitionEntry.update({ where: { id: r.id }, data: { place: r.place } });
        const prize = exhibitionPrize(r.place, config.exhibition);
        const userId = entries.find((e) => e.id === r.id)!.userId;
        if (!prize) continue;
        const refId = `exhibition:${ex.weekKey}:${r.place}`;
        await changeBalance(tx, { userId, currency: 'chips', delta: prize.chips, reason: 'prize', refId });
        await changeBalance(tx, { userId, currency: 'rolls', delta: prize.rolls, reason: 'prize', refId });
        awarded.push({ userId, place: r.place, ...prize });
      }
      await tx.exhibition.update({ where: { id: ex.id }, data: { status: 'settled', settledAt: now } });
      return awarded;
    });
    const users = await ctx.prisma.user.findMany({ where: { id: { in: prizes.map((p) => p.userId) } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    await afterCommit(
      ctx,
      ...prizes.map((p) =>
        ctx.notifier.send(byId.get(p.userId)!, { type: 'reward', reason: 'exhibition', place: p.place, chips: p.chips, rolls: p.rolls }),
      ),
    );
  }
  return open.length;
}
