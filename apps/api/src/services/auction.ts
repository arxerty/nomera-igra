import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  auctionStartPrice,
  classifyPlate,
  endsAtAfterBid,
  formatPlate,
  gameDayKey,
  generatePlate,
  minNextBid,
  plateBody,
  plateKey,
  plateValue,
  rollAuctionTier,
  validateBid,
  type AuctionDto,
  type BidError,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING, lockUsers, withTx } from '../lib/db';
import { PUBLIC_USER_SELECT, plateDto, userPublic } from '../lib/dto';
import { AppError, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { cryptoRng } from '../lib/rng';
import { notifyDreamMatches } from './dream';

const AUCTION_INCLUDE = {
  plate: { include: WITH_ACTIVE_LISTING },
  bids: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: { select: PUBLIC_USER_SELECT } } },
} satisfies Prisma.AuctionInclude;
type AuctionRow = Prisma.AuctionGetPayload<{ include: typeof AUCTION_INCLUDE }>;

async function auctionDto(ctx: AppContext, a: AuctionRow, viewerId: string): Promise<AuctionDto> {
  const { config } = await ctx.config.get();
  const leader = a.leaderId
    ? await ctx.prisma.user.findUnique({ where: { id: a.leaderId }, select: PUBLIC_USER_SELECT })
    : null;
  return {
    id: a.id,
    plate: plateDto(a.plate),
    status: a.status,
    startPrice: a.startPrice,
    currentBid: a.currentBid,
    minNextBid: minNextBid(a.currentBid, a.startPrice, config.auction),
    leader: leader ? userPublic(leader) : null,
    isLeader: a.leaderId === viewerId,
    endsAt: a.endsAt.toISOString(),
    bids: a.bids.map((b) => ({ user: userPublic(b.user), amount: b.amount, at: b.createdAt.toISOString() })),
  };
}

/** Текущий лот или, если его нет, последний завершённый. */
export async function getAuction(ctx: AppContext, viewerId: string): Promise<AuctionDto | null> {
  const a =
    (await ctx.prisma.auction.findFirst({ where: { status: 'active' }, orderBy: { startsAt: 'desc' }, include: AUCTION_INCLUDE })) ??
    (await ctx.prisma.auction.findFirst({ orderBy: { startsAt: 'desc' }, include: AUCTION_INCLUDE }));
  return a ? auctionDto(ctx, a, viewerId) : null;
}

/**
 * Создаёт лот на сегодня, если его ещё нет: генерирует свободный легендарный или
 * мифический номер и резервирует его (reserved), чтобы его нельзя было выбить.
 */
export async function ensureTodayAuction(ctx: AppContext): Promise<boolean> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const dayKey = gameDayKey(now, config.economy.dayOffsetHours);
  if (await ctx.prisma.auction.findUnique({ where: { dayKey } })) return false;

  const tier = rollAuctionTier(cryptoRng, config.auction);
  const generator = { regions: config.regions, rarity: config.rarity };
  const created = await withTx(ctx.prisma, async (tx) => {
    for (let i = 0; i < 30; i++) {
      const plate = generatePlate(tier, cryptoRng, generator) ?? generatePlate('legendary', cryptoRng, generator);
      if (!plate) return null;
      const rarity = classifyPlate(plate, config.rarity);
      const value = plateValue(rarity, config.prices);
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "Plate" (id, key, body, letters, number, region, tier, value, traits, bonuses, reserved, "rolledTimes")
        VALUES (${randomUUID()}, ${plateKey(plate)}, ${plateBody(plate)}, ${plate.letters}, ${plate.number}, ${plate.region},
                ${rarity.tier}::"Tier", ${value}, ${rarity.traits}::text[], ${rarity.bonuses}::text[], true, 0)
        ON CONFLICT (key) DO UPDATE SET reserved = true, tier = EXCLUDED.tier, value = EXCLUDED.value
        WHERE "Plate"."ownerId" IS NULL AND NOT "Plate".reserved
        RETURNING id`;
      const plateId = rows[0]?.id;
      if (!plateId) continue;
      const endsAt = new Date(now.getTime() + config.auction.durationHours * 3_600_000);
      // ON CONFLICT по dayKey: если лот успел создать другой процесс, транзакция откатится и резерв снимется.
      return tx.auction.create({
        data: {
          dayKey,
          plateId,
          startPrice: auctionStartPrice(value, config.auction),
          startsAt: now,
          endsAt,
          originalEndsAt: endsAt,
        },
        include: { plate: true },
      });
    }
    return null;
  }).catch((err: unknown) => {
    if ((err as { code?: string }).code === 'P2002') return null;
    throw err;
  });

  if (!created) return false;
  await afterCommit(ctx, notifyDreamMatches(ctx, created.plate, 'auction', created.startPrice, created.id, null));
  return true;
}

const BID_ERRORS: Record<BidError, [number, 'auction_closed' | 'bid_too_low' | 'already_leading', string]> = {
  auction_ended: [409, 'auction_closed', 'Аукцион уже завершён'],
  bid_too_low: [409, 'bid_too_low', 'Ставка меньше минимальной'],
  already_leading: [409, 'already_leading', 'Ваша ставка и так лидирует'],
};

/**
 * Ставка. Сумма сразу удерживается с баланса; перебитому лидеру его ставка возвращается.
 * Ставка в последнюю минуту продлевает аукцион (антиснайпинг).
 */
export async function placeBid(ctx: AppContext, userId: string, auctionId: string, amount: number): Promise<AuctionDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const result = await withTx(ctx.prisma, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Auction" WHERE id = ${auctionId} FOR UPDATE`;
    if (!rows[0]) throw notFound('Аукцион не найден');
    const a = await tx.auction.findUniqueOrThrow({ where: { id: auctionId }, include: { plate: true } });
    const error =
      a.status !== 'active'
        ? 'auction_ended'
        : validateBid(
            { amount, bidderId: userId, at: now },
            { currentBid: a.currentBid, leaderId: a.leaderId, startPrice: a.startPrice, endsAt: a.endsAt },
            config.auction,
          );
    if (error) {
      const [status, code, message] = BID_ERRORS[error];
      throw new AppError(status, code, message);
    }

    await lockUsers(tx, [userId, ...(a.leaderId ? [a.leaderId] : [])]);
    await changeBalance(tx, { userId, currency: 'chips', delta: -amount, reason: 'auction_bid', refId: auctionId });
    if (a.leaderId && a.currentBid !== null) {
      await changeBalance(tx, { userId: a.leaderId, currency: 'chips', delta: a.currentBid, reason: 'auction_refund', refId: auctionId });
    }
    await tx.auction.update({
      where: { id: auctionId },
      data: { currentBid: amount, leaderId: userId, endsAt: endsAtAfterBid(a.endsAt, a.originalEndsAt, now, config.auction) },
    });
    await tx.auctionBid.create({ data: { auctionId, userId, amount, createdAt: now } });
    const outbid = a.leaderId ? await tx.user.findUniqueOrThrow({ where: { id: a.leaderId } }) : null;
    return { outbid, plate: a.plate };
  });

  if (result.outbid) {
    await afterCommit(
      ctx,
      ctx.notifier.send(result.outbid, { type: 'auction_outbid', plate: formatPlate(result.plate), amount }),
    );
  }
  const fresh = await ctx.prisma.auction.findUniqueOrThrow({ where: { id: auctionId }, include: AUCTION_INCLUDE });
  return auctionDto(ctx, fresh, userId);
}

/** Подводит итоги завершившихся аукционов: номер — лидеру, без ставок — обратно в пул. */
export async function settleAuctions(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  const due = await ctx.prisma.auction.findMany({ where: { status: 'active', endsAt: { lte: now } }, select: { id: true } });
  let settled = 0;
  for (const { id } of due) {
    const won = await withTx(ctx.prisma, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Auction" WHERE id = ${id} AND status = 'active' FOR UPDATE`;
      if (!rows[0]) return null;
      const a = await tx.auction.findUniqueOrThrow({ where: { id }, include: { plate: true } });
      if (!a.leaderId || a.currentBid === null) {
        await tx.auction.update({ where: { id }, data: { status: 'unsold', settledAt: now } });
        await tx.plate.update({ where: { id: a.plateId }, data: { reserved: false } });
        return null;
      }
      await tx.plate.update({ where: { id: a.plateId }, data: { reserved: false, ownerId: a.leaderId, acquiredAt: now } });
      await tx.plateOwnership.create({
        data: { plateId: a.plateId, userId: a.leaderId, acquiredAt: now, acquiredVia: 'auction', acquiredPrice: a.currentBid },
      });
      await tx.auction.update({ where: { id }, data: { status: 'settled', settledAt: now } });
      await tx.dealLog.create({
        data: { type: 'auction', plateKeys: [a.plate.key], toUserId: a.leaderId, price: a.currentBid, refId: id },
      });
      const winner = await tx.user.findUniqueOrThrow({ where: { id: a.leaderId } });
      return { winner, plate: a.plate, price: a.currentBid };
    });
    settled++;
    if (won) {
      await afterCommit(
        ctx,
        ctx.leaderboard.refreshUsers([won.winner.id]),
        ctx.notifier.send(won.winner, { type: 'auction_won', plate: formatPlate(won.plate), price: won.price }),
      );
    }
  }
  return settled;
}
