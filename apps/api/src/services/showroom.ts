import { z } from 'zod';
import {
  DEFAULT_CAR_MODELS,
  carCatalogSchema,
  gameDayKey,
  nextGameDayStart,
  showroomForDay,
  type CarDto,
  type CarModel,
  type GameConfig,
  type ShowroomDto,
} from '@nomer/shared';
import type { PrismaClient } from '@prisma/client';
import { afterCommit, type AppContext } from '../context';
import { assertGarageSpace, carDto, carModelDto, garageSlotsDto, loadGarages, modelFromRow, newCarTuning } from '../lib/cars';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { trackQuest } from './quests';

/**
 * Кладёт каталог моделей из @nomer/shared в таблицу CarModel. Счётчик продаж не трогает;
 * модели, которых больше нет в каталоге, помечаются retired (купленные машины остаются).
 */
export async function syncCarCatalog(prisma: PrismaClient, models: CarModel[] = DEFAULT_CAR_MODELS): Promise<void> {
  carCatalogSchema.parse(models);
  for (const m of models) {
    const data = {
      brand: m.brand,
      name: m.name,
      year: m.year,
      class: m.class,
      archetype: m.archetype,
      speed: m.stats.speed,
      acceleration: m.stats.acceleration,
      handling: m.stats.handling,
      prestige: m.stats.prestige,
      priceChips: m.priceChips,
      priceStars: m.priceStars ?? null,
      showroom: m.showroom,
      editionSize: m.editionSize ?? null,
      styleNumbers: m.styleNumbers ?? [],
      season: m.season ?? null,
      retired: false,
    };
    await prisma.carModel.upsert({ where: { id: m.id }, create: { id: m.id, ...data }, update: data });
  }
  await prisma.carModel.updateMany({ where: { id: { notIn: models.map((m) => m.id) } }, data: { retired: true } });
}

/** Модели, которые продаются сегодня. */
async function todaysModels(db: PrismaClient | Tx, config: GameConfig, now: Date) {
  const dayKey = gameDayKey(now, config.economy.dayOffsetHours);
  const rows = await db.carModel.findMany({ where: { retired: false }, orderBy: [{ priceChips: 'asc' }, { id: 'asc' }] });
  const sold = new Map(rows.map((r) => [r.id, r.sold]));
  const ids = new Set(showroomForDay(rows.map(modelFromRow), dayKey, config.cars.showroom.rotatingSlots, sold).map((m) => m.id));
  return { dayKey, rows: rows.filter((r) => ids.has(r.id)) };
}

export async function getShowroom(ctx: AppContext, userId: string): Promise<ShowroomDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const [{ dayKey, rows }, user, used] = await Promise.all([
    todaysModels(ctx.prisma, config, now),
    ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ctx.prisma.userCar.count({ where: { ownerId: userId } }),
  ]);
  return {
    dayKey,
    rotatesAt: nextGameDayStart(now, config.economy.dayOffsetHours).toISOString(),
    models: rows.map(carModelDto),
    garage: garageSlotsDto(user, used, config),
  };
}

export const buyCarSchema = z.object({ color: z.string().optional() });

/**
 * Создаёт машину в гараже. Для коллекционных моделей атомарно занимает экземпляр тиража:
 * UPDATE … WHERE sold < editionSize не даст продать 101-й экземпляр даже при гонке запросов.
 * Вызывающий отвечает за оплату и проверку места в гараже.
 */
export async function createCar(
  tx: Tx,
  args: { userId: string; modelId: string; color?: string; price: number | null; at: Date; config: GameConfig },
) {
  const rows = await tx.$queryRaw<{ sold: number; editionSize: number | null }[]>`
    UPDATE "CarModel" SET sold = sold + 1, "updatedAt" = now()
    WHERE id = ${args.modelId} AND NOT retired AND ("editionSize" IS NULL OR sold < "editionSize")
    RETURNING sold, "editionSize"`;
  const row = rows[0];
  if (!row) throw new AppError(409, 'sold_out', 'Тираж этой модели распродан');
  const car = await tx.userCar.create({
    data: {
      ownerId: args.userId,
      modelId: args.modelId,
      serial: row.editionSize === null ? null : row.sold,
      tuning: newCarTuning(args.config, args.color) as object,
      acquiredAt: args.at,
    },
  });
  await tx.carOwnership.create({
    data: { carId: car.id, userId: args.userId, acquiredAt: args.at, acquiredVia: 'showroom', acquiredPrice: args.price },
  });
  return car;
}

/** Покупка машины в салоне за Фишки. */
export async function buyCar(ctx: AppContext, userId: string, modelId: string, color?: string): Promise<CarDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();

  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const { rows } = await todaysModels(tx, config, now);
    const model = rows.find((r) => r.id === modelId);
    if (!model) {
      const exists = await tx.carModel.findUnique({ where: { id: modelId } });
      if (!exists) throw notFound('Модель не найдена');
      throw new AppError(409, 'not_in_showroom', 'Этой модели сегодня нет в салоне');
    }
    await assertGarageSpace(tx, userId, config);
    const car = await createCar(tx, { userId, modelId, color, price: model.priceChips, at: now, config });
    await changeBalance(tx, { userId, currency: 'chips', delta: -model.priceChips, reason: 'car_purchase', refId: car.id });
    await trackQuest(tx, config, userId, 'car_buy', { at: now, carClass: model.class });
    const garage = (await loadGarages(tx, [userId])).get(userId)!;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return carDto(garage.find((c) => c.id === car.id)!, garage, config, now, user.locale === 'en' ? 'en' : 'ru');
  });

  await afterCommit(ctx, ctx.leaderboard.refreshUsers([userId]));
  return result;
}

/** Докупка места в гараже за Фишки. */
export async function buyGarageSlot(ctx: AppContext, userId: string) {
  const { config } = await ctx.config.get();
  return withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const used = await tx.userCar.count({ where: { ownerId: userId } });
    const slots = garageSlotsDto(user, used, config);
    if (!slots.nextSlot) throw new AppError(409, 'limit_reached', 'Гараж уже максимального размера');
    const chips = await changeBalance(tx, {
      userId,
      currency: 'chips',
      delta: -slots.nextSlot.chips,
      reason: 'garage_slot',
      refId: `slot:${slots.slots + 1}`,
    });
    const updated = await tx.user.update({ where: { id: userId }, data: { extraGarageSlots: { increment: 1 } } });
    return { chips, garage: garageSlotsDto(updated, used, config) };
  });
}
