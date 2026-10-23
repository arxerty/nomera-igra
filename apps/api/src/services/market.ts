import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  TIERS,
  formatPlate,
  isValidRegionCode,
  marketSettlement,
  maskToSqlLike,
  parseMask,
  type ListingDto,
  type Page,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING, assertPlateFree, lockOwnedPlate, lockPlates, lockUsers, transferPlate, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, plateDto, userPublic } from '../lib/dto';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { notifyDreamMatches } from './dream';
import { trackQuest } from './quests';

export const marketQuerySchema = z.object({
  mask: z.string().max(16).optional(),
  region: z.string().refine(isValidRegionCode).optional(),
  tier: z.enum(TIERS).optional(),
  sellerId: z.string().optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'value_desc']).default('newest'),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MarketQuery = z.infer<typeof marketQuerySchema>;

const ORDER: Record<MarketQuery['sort'], Prisma.Sql> = {
  newest: Prisma.sql`l."createdAt" DESC, l.id DESC`,
  price_asc: Prisma.sql`l.price ASC, l.id ASC`,
  price_desc: Prisma.sql`l.price DESC, l.id DESC`,
  value_desc: Prisma.sql`p.value DESC, l.id DESC`,
};

const LISTING_INCLUDE = {
  plate: { include: WITH_ACTIVE_LISTING },
  seller: { select: PUBLIC_USER_SELECT },
} satisfies Prisma.ListingInclude;

type ListingRow = Prisma.ListingGetPayload<{ include: typeof LISTING_INCLUDE }>;

function listingDto(l: ListingRow, viewerId: string): ListingDto {
  return {
    id: l.id,
    price: l.price,
    createdAt: l.createdAt.toISOString(),
    seller: userPublic(l.seller),
    plate: plateDto(l.plate),
    isMine: l.sellerId === viewerId,
  };
}

/** Поиск активных лотов. Маска — "*777**", "А***АА", "*777** 77" (см. parseMask). */
export async function searchListings(ctx: AppContext, viewerId: string, q: MarketQuery): Promise<Page<ListingDto>> {
  const conds: Prisma.Sql[] = [Prisma.sql`l.status = 'active'`];
  if (q.mask) {
    const mask = parseMask(q.mask);
    if (!mask) throw badRequest('Некорректная маска. Пример: *777** или А***АА 77');
    const like = maskToSqlLike(mask);
    conds.push(Prisma.sql`p.body LIKE ${like.body}`);
    if (like.region) conds.push(Prisma.sql`p.region LIKE ${like.region}`);
  }
  if (q.region) conds.push(Prisma.sql`p.region = ${q.region}`);
  if (q.tier) conds.push(Prisma.sql`p.tier = ${q.tier}::"Tier"`);
  if (q.sellerId) conds.push(Prisma.sql`l."sellerId" = ${q.sellerId}`);

  const offset = q.cursor ?? 0;
  const ids = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM "Listing" l JOIN "Plate" p ON p.id = l."plateId"
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY ${ORDER[q.sort]}
    LIMIT ${q.limit + 1} OFFSET ${offset}`;

  const pageIds = ids.slice(0, q.limit).map((r) => r.id);
  const rows = await ctx.prisma.listing.findMany({ where: { id: { in: pageIds } }, include: LISTING_INCLUDE });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    items: pageIds.map((id) => listingDto(byId.get(id)!, viewerId)),
    nextCursor: ids.length > q.limit ? String(offset + q.limit) : null,
  };
}

export async function createListing(ctx: AppContext, userId: string, plateId: string, price: number): Promise<ListingDto> {
  const { config } = await ctx.config.get();
  const { minListingPrice, maxListingPrice } = config.economy;
  if (!Number.isInteger(price) || price < minListingPrice || price > maxListingPrice) {
    throw badRequest(`Цена должна быть от ${minListingPrice} до ${maxListingPrice} Фишек`);
  }
  const now = ctx.now();

  const listing = await withTx(ctx.prisma, async (tx) => {
    const plate = await lockOwnedPlate(tx, plateId, userId);
    assertPlateFree(plate);
    const created = await tx.listing.create({
      data: { plateId, sellerId: userId, price, activePlateId: plateId },
      include: LISTING_INCLUDE,
    });
    await trackQuest(tx, config, userId, 'market_list', { at: now, tier: plate.tier });
    return created;
  });
  await afterCommit(ctx, notifyDreamMatches(ctx, listing.plate, 'market', price, listing.id, userId));
  return listingDto(listing, userId);
}

async function lockListing(tx: Tx, listingId: string) {
  const rows = await tx.$queryRaw<{ id: string; sellerId: string; plateId: string; price: number; status: string }[]>`
    SELECT id, "sellerId", "plateId", price, status FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw notFound('Лот не найден');
  if (row.status !== 'active') throw conflict('listing_closed', 'Лот уже продан или снят с продажи');
  return row;
}

export async function cancelListing(ctx: AppContext, userId: string, listingId: string): Promise<void> {
  await withTx(ctx.prisma, async (tx) => {
    const listing = await lockListing(tx, listingId);
    if (listing.sellerId !== userId) throw forbidden('Это не ваш лот');
    await tx.listing.update({
      where: { id: listingId },
      data: { status: 'cancelled', activePlateId: null, closedAt: ctx.now() },
    });
  });
}

/**
 * Покупка лота. Лот блокируется FOR UPDATE, поэтому два одновременных
 * покупателя не купят его оба: второй увидит статус sold и получит 409.
 */
export async function buyListing(ctx: AppContext, buyerId: string, listingId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();

  const result = await withTx(ctx.prisma, async (tx) => {
    const listing = await lockListing(tx, listingId);
    if (listing.sellerId === buyerId) throw conflict('own_listing', 'Нельзя купить свой лот');

    await lockUsers(tx, [buyerId, listing.sellerId]);
    await lockPlates(tx, [listing.plateId]);
    const plate = await tx.plate.findUniqueOrThrow({ where: { id: listing.plateId } });
    if (plate.ownerId !== listing.sellerId) {
      ctx.log.error({ listingId, plateId: plate.id }, 'Лот указывает на номер другого владельца');
      throw conflict('listing_closed', 'Лот больше недоступен');
    }

    const { price, fee, sellerReceives } = marketSettlement(listing.price, config.economy.marketFeePercent);
    const buyerChips = await changeBalance(tx, {
      userId: buyerId,
      currency: 'chips',
      delta: -price,
      reason: 'market_buy',
      refId: listingId,
    });
    await changeBalance(tx, {
      userId: listing.sellerId,
      currency: 'chips',
      delta: sellerReceives,
      reason: 'market_sale',
      refId: listingId,
    });
    await transferPlate(tx, { plateId: plate.id, fromUserId: listing.sellerId, toUserId: buyerId, via: 'market', price, at: now });
    await tx.listing.update({
      where: { id: listingId },
      data: { status: 'sold', buyerId, fee, activePlateId: null, closedAt: now },
    });
    await tx.dealLog.create({
      data: {
        type: 'market_sale',
        plateKeys: [plate.key],
        fromUserId: listing.sellerId,
        toUserId: buyerId,
        price,
        fee,
        refId: listingId,
      },
    });
    await trackQuest(tx, config, buyerId, 'market_buy', { at: now, tier: plate.tier });
    await trackQuest(tx, config, listing.sellerId, 'market_sell', { at: now, tier: plate.tier });

    const seller = await tx.user.findUniqueOrThrow({ where: { id: listing.sellerId } });
    const bought = await tx.plate.findUniqueOrThrow({ where: { id: plate.id }, include: WITH_ACTIVE_LISTING });
    return { buyerChips, seller, plate: bought, price, sellerReceives };
  });

  const { seller, plate } = result;
  await afterCommit(
    ctx,
    ctx.leaderboard.refreshUsers([buyerId, seller.id]),
    ctx.notifier.send(seller, {
      type: 'plate_sold',
      plate: formatPlate(plate),
      tier: plate.tier,
      price: result.price,
      received: result.sellerReceives,
    }),
  );
  return { chips: result.buyerChips, plate: plateDto(plate) };
}
