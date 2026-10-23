import type { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import {
  CAR_CLASSES,
  carModelTitle,
  formatPlate,
  marketSettlement,
  type CarListingDto,
  type Locale,
  type Page,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { CAR_INCLUDE, assertCarIdle, assertGarageSpace, carDtosFor, lockOwnedCar, modelFromRow } from '../lib/cars';
import { lockUsers, transferPlate, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, userPublic } from '../lib/dto';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { notifyDreamMatches } from './dream';
import { collectFinishedTrips } from './trips';

export const carMarketQuerySchema = z.object({
  carClass: z.enum(CAR_CLASSES).optional(),
  modelId: z.string().optional(),
  withPlate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CarMarketQuery = z.infer<typeof carMarketQuerySchema>;

const ORDER: Record<CarMarketQuery['sort'], Prisma.CarListingOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  price_asc: [{ price: 'asc' }, { id: 'asc' }],
  price_desc: [{ price: 'desc' }, { id: 'desc' }],
};

const LISTING_INCLUDE = {
  car: { include: CAR_INCLUDE },
  seller: { select: PUBLIC_USER_SELECT },
} satisfies Prisma.CarListingInclude;
type ListingRow = Prisma.CarListingGetPayload<{ include: typeof LISTING_INCLUDE }>;

const localeOf = (u: Pick<User, 'locale'>): Locale => (u.locale === 'en' ? 'en' : 'ru');

async function listingDtos(ctx: AppContext, rows: ListingRow[], viewer: User): Promise<CarListingDto[]> {
  const { config } = await ctx.config.get();
  const cars = await carDtosFor(ctx.prisma, rows.map((r) => r.car), config, ctx.now(), localeOf(viewer));
  return rows.map((l) => ({
    id: l.id,
    price: l.price,
    withPlate: l.withPlate,
    createdAt: l.createdAt.toISOString(),
    seller: userPublic(l.seller),
    car: cars.get(l.carId)!,
    isMine: l.sellerId === viewer.id,
  }));
}

export async function searchCarListings(ctx: AppContext, viewer: User, q: CarMarketQuery): Promise<Page<CarListingDto>> {
  const offset = q.cursor ?? 0;
  const rows = await ctx.prisma.carListing.findMany({
    where: {
      status: 'active',
      withPlate: q.withPlate,
      car: { modelId: q.modelId, model: q.carClass ? { class: q.carClass } : undefined },
    },
    orderBy: ORDER[q.sort],
    skip: offset,
    take: q.limit + 1,
    include: LISTING_INCLUDE,
  });
  const page = rows.slice(0, q.limit);
  return {
    items: await listingDtos(ctx, page, viewer),
    nextCursor: rows.length > q.limit ? String(offset + q.limit) : null,
  };
}

/**
 * Выставить машину на рынок. Она продаётся в том виде, в каком есть:
 * с висящим номером (withPlate) или без — чтобы продать без номера, его сначала снимают.
 */
export async function createCarListing(ctx: AppContext, user: User, carId: string, price: number): Promise<CarListingDto> {
  const { config } = await ctx.config.get();
  const { minListingPrice, maxListingPrice } = config.economy;
  if (!Number.isInteger(price) || price < minListingPrice || price > maxListingPrice) {
    throw badRequest(`Цена должна быть от ${minListingPrice} до ${maxListingPrice} Фишек`);
  }
  const now = ctx.now();
  const listing = await withTx(ctx.prisma, async (tx) => {
    await collectFinishedTrips(tx, { carIds: [carId] }, now);
    const car = await lockOwnedCar(tx, carId, user.id);
    assertCarIdle(car, now);
    const created = await tx.carListing.create({
      data: { carId, sellerId: user.id, price, withPlate: car.plateId !== null, activeCarId: carId },
    });
    return tx.carListing.findUniqueOrThrow({ where: { id: created.id }, include: LISTING_INCLUDE });
  });
  const plate = listing.car.plate;
  if (plate) await afterCommit(ctx, notifyDreamMatches(ctx, plate, 'market', price, listing.id, user.id));
  return (await listingDtos(ctx, [listing], user))[0]!;
}

async function lockCarListing(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string; sellerId: string; carId: string; price: number; status: string }[]>`
    SELECT id, "sellerId", "carId", price, status FROM "CarListing" WHERE id = ${id} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw notFound('Лот не найден');
  if (row.status !== 'active') throw conflict('listing_closed', 'Лот уже продан или снят с продажи');
  return row;
}

export async function cancelCarListing(ctx: AppContext, userId: string, listingId: string): Promise<void> {
  await withTx(ctx.prisma, async (tx) => {
    const listing = await lockCarListing(tx, listingId);
    if (listing.sellerId !== userId) throw forbidden('Это не ваш лот');
    await tx.carListing.update({
      where: { id: listingId },
      data: { status: 'cancelled', activeCarId: null, closedAt: ctx.now() },
    });
  });
}

/** Покупка машины. Номер, если продаётся вместе с ней, переходит к покупателю с записью в паспорт. */
export async function buyCarListing(ctx: AppContext, buyerId: string, listingId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();

  const result = await withTx(ctx.prisma, async (tx) => {
    const listing = await lockCarListing(tx, listingId);
    if (listing.sellerId === buyerId) throw conflict('own_listing', 'Нельзя купить свой лот');
    await lockUsers(tx, [buyerId, listing.sellerId]);
    await collectFinishedTrips(tx, { carIds: [listing.carId] }, now);
    const car = await lockOwnedCar(tx, listing.carId, listing.sellerId).catch(() => {
      throw conflict('listing_closed', 'Лот больше недоступен');
    });
    await assertGarageSpace(tx, buyerId, config);

    const { price, fee, sellerReceives } = marketSettlement(listing.price, config.economy.marketFeePercent);
    const buyerChips = await changeBalance(tx, { userId: buyerId, currency: 'chips', delta: -price, reason: 'car_market_buy', refId: listingId });
    await changeBalance(tx, { userId: listing.sellerId, currency: 'chips', delta: sellerReceives, reason: 'car_market_sale', refId: listingId });

    await tx.carListing.update({
      where: { id: listingId },
      data: { status: 'sold', buyerId, fee, activeCarId: null, closedAt: now },
    });
    await tx.userCar.update({ where: { id: car.id }, data: { ownerId: buyerId, acquiredAt: now } });
    await tx.carOwnership.updateMany({
      where: { carId: car.id, userId: listing.sellerId, releasedAt: null },
      data: { releasedAt: now, releasedVia: 'market', releasedPrice: price },
    });
    await tx.carOwnership.create({
      data: { carId: car.id, userId: buyerId, acquiredAt: now, acquiredVia: 'market', acquiredPrice: price },
    });
    if (car.plate) {
      await transferPlate(tx, { plateId: car.plate.id, fromUserId: listing.sellerId, toUserId: buyerId, via: 'market', price: null, at: now });
    }
    await tx.dealLog.create({
      data: {
        type: 'car_market_sale',
        plateKeys: car.plate ? [car.plate.key] : [],
        carIds: [car.id],
        fromUserId: listing.sellerId,
        toUserId: buyerId,
        price,
        fee,
        refId: listingId,
      },
    });
    const seller = await tx.user.findUniqueOrThrow({ where: { id: listing.sellerId } });
    const title = carModelTitle(modelFromRow(car.model)) + (car.plate ? ` · ${formatPlate(car.plate)}` : '');
    return { buyerChips, seller, title, price, sellerReceives, carId: car.id };
  });

  await afterCommit(
    ctx,
    ctx.leaderboard.refreshUsers([buyerId, result.seller.id]),
    ctx.notifier.send(result.seller, { type: 'car_sold', car: result.title, price: result.price, received: result.sellerReceives }),
  );
  return { chips: result.buyerChips, carId: result.carId };
}
