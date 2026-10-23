import { z } from 'zod';
import {
  PAINT_FINISHES,
  carCombos,
  carSellBackPrice,
  largestSeries,
  plateChangeAvailableAt,
  tuningCost,
  type CarCardDto,
  type CarDto,
  type CarGarageDto,
  type CarTuning,
  type Locale,
} from '@nomer/shared';
import type { User } from '@prisma/client';
import { afterCommit, type AppContext } from '../context';
import {
  CAR_INCLUDE,
  assertCarIdle,
  carDto,
  carDtosFor,
  garageCarOf,
  garageSlotsDto,
  loadGarages,
  lockOwnedCar,
  parseTuning,
} from '../lib/cars';
import { assertPlateFree, lockOwnedPlate, lockUsers, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, userPublic } from '../lib/dto';
import { AppError, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { grantAchievement } from './achievements';
import { trackQuest } from './quests';
import { collectFinishedTrips } from './trips';

const localeOf = (u: Pick<User, 'locale'>): Locale => (u.locale === 'en' ? 'en' : 'ru');

async function garageDto(ctx: AppContext, db: AppContext['prisma'] | Tx, userId: string): Promise<CarGarageDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const [user, garages] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    loadGarages(db, [userId]),
  ]);
  const rows = garages.get(userId)!;
  const cars = rows.map((r) => carDto(r, rows, config, now, localeOf(user)));
  return {
    cars,
    garage: garageSlotsDto(user, rows.length, config),
    unlockedPaints: user.unlockedPaints,
    totalValue: cars.reduce((s, c) => s + c.value, 0),
  };
}

export function listMyCars(ctx: AppContext, userId: string): Promise<CarGarageDto> {
  return garageDto(ctx, ctx.prisma, userId);
}

/** Машины другого игрока (из рейтинга или клуба). */
export async function listUserCars(ctx: AppContext, viewer: User, ownerId: string): Promise<CarDto[]> {
  const { config } = await ctx.config.get();
  const rows = (await loadGarages(ctx.prisma, [ownerId])).get(ownerId)!;
  return rows.map((r) => carDto(r, rows, config, ctx.now(), localeOf(viewer)));
}

async function myCar(ctx: AppContext, tx: Tx, userId: string, carId: string): Promise<CarDto> {
  const { config } = await ctx.config.get();
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const rows = (await loadGarages(tx, [userId])).get(userId)!;
  return carDto(rows.find((r) => r.id === carId)!, rows, config, ctx.now(), localeOf(user));
}

/** Карточка машины с историей владельцев. Машины публичны, как и номера. */
export async function carCard(ctx: AppContext, viewer: User, carId: string): Promise<CarCardDto> {
  const { config } = await ctx.config.get();
  const row = await ctx.prisma.userCar.findUnique({ where: { id: carId }, include: CAR_INCLUDE });
  if (!row) throw notFound('Машина не найдена');
  const [dtos, owner, history] = await Promise.all([
    carDtosFor(ctx.prisma, [row], config, ctx.now(), localeOf(viewer)),
    row.ownerId ? ctx.prisma.user.findUnique({ where: { id: row.ownerId }, select: PUBLIC_USER_SELECT }) : null,
    ctx.prisma.carOwnership.findMany({
      where: { carId },
      orderBy: { acquiredAt: 'desc' },
      take: 50,
      include: { user: { select: PUBLIC_USER_SELECT } },
    }),
  ]);
  const prices = history.flatMap((h) => [h.acquiredPrice, h.releasedPrice]).filter((p): p is number => p !== null);
  return {
    car: dtos.get(carId)!,
    owner: owner ? userPublic(owner) : null,
    history: history.map((h) => ({
      owner: userPublic(h.user),
      acquiredAt: h.acquiredAt.toISOString(),
      acquiredVia: h.acquiredVia,
      acquiredPrice: h.acquiredPrice,
      releasedAt: h.releasedAt?.toISOString() ?? null,
    })),
    recordPrice: prices.length ? Math.max(...prices) : null,
  };
}

/** Общая подготовка к смене номера: машина свободна и кулдаун прошёл. */
async function lockCarForPlateChange(ctx: AppContext, tx: Tx, userId: string, carId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  await lockUsers(tx, [userId]);
  await collectFinishedTrips(tx, { carIds: [carId] }, now);
  const car = await lockOwnedCar(tx, carId, userId);
  assertCarIdle(car, now);
  const until = plateChangeAvailableAt(car.plateChangedAt, now, config.cars);
  if (until) {
    throw new AppError(409, 'plate_change_cooldown', `Номер на этой машине можно сменить после ${until.toISOString()}`);
  }
  return { car, config, now };
}

/**
 * Повесить номер из гаража на машину. Если на машине уже был номер, он снимается
 * с «госпошлиной». Номер на машине нельзя продать, выставить или обменять.
 */
export async function mountPlate(ctx: AppContext, userId: string, carId: string, plateId: string): Promise<CarDto> {
  const result = await withTx(ctx.prisma, async (tx) => {
    const { car, config, now } = await lockCarForPlateChange(ctx, tx, userId, carId);
    if (car.plateId === plateId) throw new AppError(409, 'plate_mounted', 'Этот номер уже на машине');
    const plate = await lockOwnedPlate(tx, plateId, userId);
    assertPlateFree(plate);

    if (car.plateId) {
      await changeBalance(tx, {
        userId,
        currency: 'chips',
        delta: -config.cars.plateMount.removeFeeChips,
        reason: 'plate_fee',
        refId: car.id,
      });
    }
    await tx.userCar.update({ where: { id: carId }, data: { plateId, plateChangedAt: now } });

    const garage = (await loadGarages(tx, [userId])).get(userId)!;
    const cars = garage.map(garageCarOf);
    const mounted = cars.find((c) => c.id === carId)!;
    await trackQuest(tx, config, userId, 'plate_mount', { at: now, tier: plate.tier, carClass: car.model.class });
    await trackQuest(tx, config, userId, 'series_size', { at: now, value: largestSeries(cars) });
    if (carCombos(mounted, cars, config.cars.combos).includes('mesalliance')) {
      await grantAchievement(tx, userId, 'mesalliance', now);
    }
    return myCar(ctx, tx, userId, carId);
  });
  await afterCommit(ctx, ctx.leaderboard.refreshUsers([userId]));
  return result;
}

/** Снять номер с машины в гараж (платно, с кулдауном). */
export async function unmountPlate(ctx: AppContext, userId: string, carId: string): Promise<CarDto> {
  const result = await withTx(ctx.prisma, async (tx) => {
    const { car, config, now } = await lockCarForPlateChange(ctx, tx, userId, carId);
    if (!car.plateId) throw new AppError(409, 'no_plate', 'На машине нет номера');
    await changeBalance(tx, {
      userId,
      currency: 'chips',
      delta: -config.cars.plateMount.removeFeeChips,
      reason: 'plate_fee',
      refId: car.id,
    });
    await tx.userCar.update({ where: { id: carId }, data: { plateId: null, plateChangedAt: now } });
    return myCar(ctx, tx, userId, carId);
  });
  await afterCommit(ctx, ctx.leaderboard.refreshUsers([userId]));
  return result;
}

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const tuningSchema = z.object({
  paint: z.object({ finish: z.enum(PAINT_FINISHES), color: z.string().max(64) }),
  wheels: z.number().int(),
  tint: z.number().int(),
  bodykit: z.number().int(),
  underglow: hex.nullable(),
  engine: z.number().int(),
  suspension: z.number().int(),
}) satisfies z.ZodType<CarTuning>;

/** Тюнинг: платится разница между текущим и новым набором (см. tuningCost). */
export async function tuneCar(ctx: AppContext, userId: string, carId: string, to: CarTuning): Promise<CarDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const car = await lockOwnedCar(tx, carId, userId);
    assertCarIdle(car, now);
    const from = parseTuning(car.tuning);
    const cost = tuningCost(car.model.class, from, to, config.cars.tuning);
    if (!cost.ok) throw new AppError(409, 'tuning_invalid', `Такой тюнинг недоступен: ${cost.error}`);

    const paintChanged = to.paint.finish !== from.paint.finish || to.paint.color !== from.paint.color;
    if (paintChanged && to.paint.finish === 'exclusive') {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.unlockedPaints.includes(to.paint.color)) {
        throw new AppError(409, 'tuning_invalid', 'Эта эксклюзивная окраска ещё не получена');
      }
    }
    if (cost.chips > 0) {
      await changeBalance(tx, { userId, currency: 'chips', delta: -cost.chips, reason: 'tuning', refId: carId });
    }
    await tx.userCar.update({ where: { id: carId }, data: { tuning: to as object } });
    return myCar(ctx, tx, userId, carId);
  });
  await afterCommit(ctx, ctx.leaderboard.refreshUsers([userId]));
  return result;
}

/** Продажа машины системе. Номер, если висел, возвращается в гараж игрока. */
export async function sellCarToSystem(ctx: AppContext, userId: string, carId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    await collectFinishedTrips(tx, { carIds: [carId] }, now);
    const car = await lockOwnedCar(tx, carId, userId);
    assertCarIdle(car, now);
    const price = carSellBackPrice(car.model, config.cars);

    await tx.userCar.update({ where: { id: carId }, data: { ownerId: null, plateId: null, plateChangedAt: null } });
    await tx.carOwnership.updateMany({
      where: { carId, userId, releasedAt: null },
      data: { releasedAt: now, releasedVia: 'system_sell', releasedPrice: price },
    });
    const chips = await changeBalance(tx, { userId, currency: 'chips', delta: price, reason: 'car_system_sell', refId: carId });
    await tx.dealLog.create({
      data: { type: 'car_system_sell', plateKeys: [], carIds: [carId], fromUserId: userId, price, refId: carId },
    });
    return { chips, received: price };
  });
  await afterCommit(ctx, ctx.leaderboard.refreshUsers([userId]));
  return result;
}
