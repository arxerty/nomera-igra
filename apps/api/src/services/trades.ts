import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { TradeOfferDto } from '@nomer/shared';
import { afterCommit, miniAppLink, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING, lockPlates, lockUsers, transferPlate, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, plateDto, userPublic } from '../lib/dto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { trackQuest } from './quests';

const MAX_PLATES_PER_SIDE = 10;
const MAX_PENDING_OFFERS = 20;

export const createOfferSchema = z.object({
  offeredPlateIds: z.array(z.string()).max(MAX_PLATES_PER_SIDE).default([]),
  requestedPlateIds: z.array(z.string()).max(MAX_PLATES_PER_SIDE).default([]),
  offeredChips: z.number().int().min(0).max(10_000_000).default(0),
  requestedChips: z.number().int().min(0).max(10_000_000).default(0),
  message: z.string().trim().max(200).optional(),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

const OFFER_INCLUDE = {
  from: { select: PUBLIC_USER_SELECT },
  to: { select: PUBLIC_USER_SELECT },
  items: { include: { plate: { include: WITH_ACTIVE_LISTING } } },
} satisfies Prisma.TradeOfferInclude;

type OfferRow = Prisma.TradeOfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

const invalid = (message: string) => new AppError(409, 'trade_invalid', message);

function offerDto(ctx: AppContext, o: OfferRow, viewerId: string): TradeOfferDto {
  const now = ctx.now();
  const expired = o.status === 'pending' && o.expiresAt <= now;
  const status = expired ? 'expired' : o.status;
  return {
    code: o.code,
    status,
    from: userPublic(o.from),
    to: o.to ? userPublic(o.to) : null,
    offered: o.items.filter((i) => i.side === 'offered').map((i) => plateDto(i.plate)),
    requested: o.items.filter((i) => i.side === 'requested').map((i) => plateDto(i.plate)),
    offeredChips: o.offeredChips,
    requestedChips: o.requestedChips,
    message: o.message,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    link: miniAppLink(ctx, `trade_${o.code}`),
    canAccept:
      status === 'pending' && viewerId !== o.fromUserId && (o.toUserId === null || o.toUserId === viewerId),
  };
}

/**
 * Предложение обмена по ссылке. Если запрошены чужие номера, предложение адресовано
 * их владельцу; иначе его может принять любой, у кого есть ссылка.
 * Номера не резервируются — всё перепроверяется в момент принятия.
 */
export async function createOffer(ctx: AppContext, fromUserId: string, input: CreateOfferInput): Promise<TradeOfferDto> {
  const { config } = await ctx.config.get();
  const offeredIds = [...new Set(input.offeredPlateIds)];
  const requestedIds = [...new Set(input.requestedPlateIds)];
  if (offeredIds.length === 0 && requestedIds.length === 0) {
    throw badRequest('В обмене должен быть хотя бы один номер');
  }

  const plates = await ctx.prisma.plate.findMany({
    where: { id: { in: [...offeredIds, ...requestedIds] } },
    include: WITH_ACTIVE_LISTING,
  });
  const byId = new Map(plates.map((p) => [p.id, p]));

  for (const id of offeredIds) {
    const p = byId.get(id);
    if (!p || p.ownerId !== fromUserId) throw invalid('Можно предлагать только свои номера');
    if (p.listings.length > 0) throw invalid('Номер выставлен на рынок — сначала снимите его с продажи');
    if (p.car) throw invalid('Номер висит на машине — сначала снимите его');
  }
  const owners = new Set(requestedIds.map((id) => byId.get(id)?.ownerId));
  if (owners.has(undefined) || owners.has(null)) throw invalid('Запрошенный номер никому не принадлежит');
  if (owners.size > 1) throw invalid('Все запрошенные номера должны принадлежать одному игроку');
  const toUserId = (requestedIds.length > 0 ? [...owners][0] : null) as string | null;
  if (toUserId === fromUserId) throw invalid('Нельзя запросить свои же номера');

  const pending = await ctx.prisma.tradeOffer.count({
    where: { fromUserId, status: 'pending', expiresAt: { gt: ctx.now() } },
  });
  if (pending >= MAX_PENDING_OFFERS) throw invalid(`Не больше ${MAX_PENDING_OFFERS} активных предложений`);

  const offer = await ctx.prisma.tradeOffer.create({
    data: {
      code: randomBytes(6).toString('base64url'),
      fromUserId,
      toUserId,
      offeredChips: input.offeredChips,
      requestedChips: input.requestedChips,
      message: input.message || null,
      expiresAt: new Date(ctx.now().getTime() + config.economy.tradeOfferTtlHours * 3_600_000),
      items: {
        create: [
          ...offeredIds.map((plateId) => ({ plateId, side: 'offered' as const })),
          ...requestedIds.map((plateId) => ({ plateId, side: 'requested' as const })),
        ],
      },
    },
    include: OFFER_INCLUDE,
  });

  if (toUserId) {
    const [to, from] = await Promise.all([
      ctx.prisma.user.findUniqueOrThrow({ where: { id: toUserId } }),
      ctx.prisma.user.findUniqueOrThrow({ where: { id: fromUserId } }),
    ]);
    await afterCommit(ctx, ctx.notifier.send(to, { type: 'trade_offer', code: offer.code, fromName: from.firstName }));
  }
  return offerDto(ctx, offer, fromUserId);
}

export async function getOffer(ctx: AppContext, viewerId: string, code: string): Promise<TradeOfferDto> {
  const offer = await ctx.prisma.tradeOffer.findUnique({ where: { code }, include: OFFER_INCLUDE });
  if (!offer) throw notFound('Предложение не найдено');
  return offerDto(ctx, offer, viewerId);
}

export async function listOffers(ctx: AppContext, userId: string) {
  const now = ctx.now();
  const where = { status: 'pending' as const, expiresAt: { gt: now } };
  const [incoming, outgoing] = await Promise.all([
    ctx.prisma.tradeOffer.findMany({ where: { ...where, toUserId: userId }, include: OFFER_INCLUDE, orderBy: { createdAt: 'desc' } }),
    ctx.prisma.tradeOffer.findMany({ where: { ...where, fromUserId: userId }, include: OFFER_INCLUDE, orderBy: { createdAt: 'desc' } }),
  ]);
  return {
    incoming: incoming.map((o) => offerDto(ctx, o, userId)),
    outgoing: outgoing.map((o) => offerDto(ctx, o, userId)),
  };
}

async function lockPendingOffer(tx: Tx, code: string, now: Date) {
  const rows = await tx.$queryRaw<{ id: string; status: string; expiresAt: Date; fromUserId: string; toUserId: string | null; offeredChips: number; requestedChips: number }[]>`
    SELECT id, status, "expiresAt", "fromUserId", "toUserId", "offeredChips", "requestedChips"
    FROM "TradeOffer" WHERE code = ${code} FOR UPDATE`;
  const offer = rows[0];
  if (!offer) throw notFound('Предложение не найдено');
  if (offer.status !== 'pending') throw conflict('trade_closed', 'Предложение уже закрыто');
  if (offer.expiresAt <= now) {
    await tx.tradeOffer.update({ where: { id: offer.id }, data: { status: 'expired', closedAt: now } });
    throw conflict('trade_closed', 'Срок предложения истёк');
  }
  return offer;
}

export async function acceptOffer(ctx: AppContext, userId: string, code: string): Promise<TradeOfferDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();

  const result = await withTx(ctx.prisma, async (tx) => {
    const offer = await lockPendingOffer(tx, code, now);
    if (offer.fromUserId === userId) throw invalid('Нельзя принять своё предложение');
    if (offer.toUserId && offer.toUserId !== userId) throw forbidden('Предложение адресовано другому игроку');

    const items = await tx.tradeItem.findMany({ where: { offerId: offer.id } });
    await lockUsers(tx, [offer.fromUserId, userId]);
    await lockPlates(tx, items.map((i) => i.plateId));
    const plates = await tx.plate.findMany({
      where: { id: { in: items.map((i) => i.plateId) } },
      include: WITH_ACTIVE_LISTING,
    });
    const byId = new Map(plates.map((p) => [p.id, p]));

    for (const item of items) {
      const plate = byId.get(item.plateId)!;
      const expectedOwner = item.side === 'offered' ? offer.fromUserId : userId;
      if (plate.ownerId !== expectedOwner) throw invalid('Состав обмена изменился: номер сменил владельца');
      if (plate.listings.length > 0) throw invalid('Один из номеров выставлен на рынок');
      if (plate.car) throw invalid('Один из номеров висит на машине');
    }

    const [from, me] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: offer.fromUserId } }),
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    if (from.chips < offer.offeredChips) throw invalid('У автора предложения не хватает Фишек');
    if (me.chips < offer.requestedChips) throw new AppError(409, 'insufficient_funds', 'Недостаточно Фишек');

    const ref = { reason: 'trade' as const, refId: offer.id };
    if (offer.offeredChips > 0) {
      await changeBalance(tx, { userId: offer.fromUserId, currency: 'chips', delta: -offer.offeredChips, ...ref });
      await changeBalance(tx, { userId, currency: 'chips', delta: offer.offeredChips, ...ref });
    }
    if (offer.requestedChips > 0) {
      await changeBalance(tx, { userId, currency: 'chips', delta: -offer.requestedChips, ...ref });
      await changeBalance(tx, { userId: offer.fromUserId, currency: 'chips', delta: offer.requestedChips, ...ref });
    }
    for (const item of items) {
      const [fromUserId, toUserId] = item.side === 'offered' ? [offer.fromUserId, userId] : [userId, offer.fromUserId];
      await transferPlate(tx, { plateId: item.plateId, fromUserId, toUserId, via: 'trade', price: null, at: now });
    }

    await tx.tradeOffer.update({
      where: { id: offer.id },
      data: { status: 'accepted', acceptedById: userId, toUserId: userId, closedAt: now },
    });
    await tx.dealLog.create({
      data: {
        type: 'trade',
        plateKeys: items.map((i) => byId.get(i.plateId)!.key),
        fromUserId: offer.fromUserId,
        toUserId: userId,
        price: offer.offeredChips - offer.requestedChips,
        refId: offer.id,
      },
    });
    await trackQuest(tx, config, offer.fromUserId, 'trade', { at: now });
    await trackQuest(tx, config, userId, 'trade', { at: now });

    const updated = await tx.tradeOffer.findUniqueOrThrow({ where: { id: offer.id }, include: OFFER_INCLUDE });
    return { updated, from, me };
  });

  await afterCommit(
    ctx,
    ctx.leaderboard.refreshUsers([result.from.id, userId]),
    ctx.notifier.send(result.from, { type: 'trade_accepted', code, byName: result.me.firstName }),
  );
  return offerDto(ctx, result.updated, userId);
}

/** Отклонить (адресат) или отозвать (автор) предложение. */
export async function closeOffer(ctx: AppContext, userId: string, code: string, action: 'decline' | 'cancel') {
  const now = ctx.now();
  await withTx(ctx.prisma, async (tx) => {
    const offer = await lockPendingOffer(tx, code, now);
    if (action === 'cancel' && offer.fromUserId !== userId) throw forbidden('Отозвать может только автор');
    if (action === 'decline' && offer.toUserId !== userId) throw forbidden('Отклонить может только адресат');
    await tx.tradeOffer.update({
      where: { id: offer.id },
      data: { status: action === 'cancel' ? 'cancelled' : 'declined', closedAt: now },
    });
  });
}
