import type { CarModel as CarModelRow, Prisma, PrismaClient, User } from '@prisma/client';
import {
  evaluateCar,
  garageSlotPrice,
  plateChangeAvailableAt,
  raceRating,
  stockTuning,
  styleNumbersOf,
  tripHourlyIncome,
  type CarDto,
  type CarModel,
  type CarModelDto,
  type CarTuning,
  type GameConfig,
  type GarageCar,
  type GarageSlotsDto,
  type Locale,
  type TripDto,
} from '@nomer/shared';
import { WITH_ACTIVE_LISTING, type Tx } from './db';
import { plateDto } from './dto';
import { AppError, notFound } from './errors';

export const CAR_INCLUDE = {
  model: true,
  plate: { include: WITH_ACTIVE_LISTING },
  listings: { where: { status: 'active' }, select: { id: true, price: true, withPlate: true }, take: 1 },
  trips: { where: { status: 'active' }, take: 1 },
  raceEntry: { select: { id: true } },
  exhibitionEntries: {
    where: { place: { not: null } },
    select: { place: true, exhibition: { select: { weekKey: true } } },
  },
} satisfies Prisma.UserCarInclude;

export type CarRow = Prisma.UserCarGetPayload<{ include: typeof CAR_INCLUDE }>;

export function modelFromRow(m: CarModelRow): CarModel {
  return {
    id: m.id,
    brand: m.brand,
    name: m.name,
    year: m.year,
    class: m.class,
    archetype: m.archetype as CarModel['archetype'],
    stats: { speed: m.speed, acceleration: m.acceleration, handling: m.handling, prestige: m.prestige },
    priceChips: m.priceChips,
    priceStars: m.priceStars ?? undefined,
    showroom: m.showroom as CarModel['showroom'],
    editionSize: m.editionSize ?? undefined,
    styleNumbers: m.styleNumbers.length > 0 ? m.styleNumbers : undefined,
    season: m.season ?? undefined,
  };
}

export function carModelDto(m: CarModelRow): CarModelDto {
  const model = modelFromRow(m);
  return {
    id: m.id,
    brand: m.brand,
    name: m.name,
    year: m.year,
    class: m.class,
    archetype: model.archetype,
    stats: model.stats,
    priceChips: m.priceChips,
    priceStars: m.priceStars,
    showroom: model.showroom,
    editionSize: m.editionSize,
    editionLeft: m.editionSize === null ? null : Math.max(0, m.editionSize - m.sold),
    season: m.season,
    styleNumbers: styleNumbersOf(model),
  };
}

export function parseTuning(json: Prisma.JsonValue): CarTuning {
  return json as unknown as CarTuning;
}

export function garageCarOf(row: CarRow): GarageCar {
  return {
    id: row.id,
    model: modelFromRow(row.model),
    tuning: parseTuning(row.tuning),
    plate: row.plate
      ? {
          plate: { letters: row.plate.letters, number: row.plate.number, region: row.plate.region },
          tier: row.plate.tier,
          value: row.plate.value,
        }
      : null,
  };
}

type TripRow = CarRow['trips'][number];

export function tripDto(t: TripRow, now: Date, config: GameConfig, locale: Locale): TripDto {
  const finished = t.endsAt.getTime() <= now.getTime();
  const event = t.eventId ? config.cars.trips.events.find((e) => e.id === t.eventId) : undefined;
  return {
    id: t.id,
    carId: t.carId,
    hours: t.hours,
    startedAt: t.startedAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    finished,
    collected: t.status === 'collected',
    baseIncome: t.baseIncome,
    income: finished ? t.income : null,
    event:
      finished && t.eventId
        ? { id: t.eventId, title: event?.title[locale] ?? t.eventId, delta: t.income - t.baseIncome }
        : null,
  };
}

/** Чем занята машина. Вернувшаяся, но не «забранная» поездка машину не держит. */
export function carBusy(row: CarRow, now: Date): CarDto['busy'] {
  const trip = row.trips[0];
  if (trip && trip.endsAt.getTime() > now.getTime()) return 'trip';
  if (row.listings.length > 0) return 'listed';
  if (row.raceEntry) return 'race_queue';
  return null;
}

const BUSY_MESSAGE: Record<NonNullable<CarDto['busy']>, string> = {
  trip: 'Машина на покатушках — дождитесь возвращения',
  listed: 'Машина выставлена на рынок — сначала снимите её с продажи',
  race_queue: 'Машина ждёт соперника в очереди гонок',
};

export function assertCarIdle(row: CarRow, now: Date): void {
  const busy = carBusy(row, now);
  if (busy) throw new AppError(409, 'car_busy', BUSY_MESSAGE[busy]);
}

/** Блокирует машину и проверяет владельца. */
export async function lockOwnedCar(tx: Tx, carId: string, userId: string): Promise<CarRow> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "UserCar" WHERE id = ${carId} FOR UPDATE`;
  if (!rows[0]) throw notFound('Машина не найдена');
  const car = await tx.userCar.findUniqueOrThrow({ where: { id: carId }, include: CAR_INCLUDE });
  if (car.ownerId !== userId) throw new AppError(403, 'not_owner', 'Это не ваша машина');
  return car;
}

export function carDto(row: CarRow, garage: readonly CarRow[], config: GameConfig, now: Date, locale: Locale): CarDto {
  const car = garageCarOf(row);
  const e = evaluateCar(car, garage.map(garageCarOf), config.cars);
  const listing = row.listings[0] ?? null;
  const trip = row.trips[0] ?? null;
  const badges = row.exhibitionEntries
    .filter((x) => x.place !== null && x.place <= 10)
    .map((x) => `exhibition:${x.exhibition.weekKey}:${x.place}`);
  if (e.combos.includes('mesalliance')) badges.unshift('mesalliance');
  return {
    id: row.id,
    ownerId: row.ownerId,
    model: carModelDto(row.model),
    serial: row.serial,
    tuning: car.tuning,
    plate: row.plate ? plateDto(row.plate) : null,
    combos: e.combos,
    multipliers: e.multipliers,
    stats: e.stats,
    prestige: e.prestige,
    value: e.value,
    raceRating: Math.round(raceRating(e.stats, config.races) * 10) / 10,
    tripHourlyIncome: row.plate
      ? Math.round(
          tripHourlyIncome(
            { prestige: e.stats.prestige, tier: row.plate.tier, incomeMultiplier: e.multipliers.income },
            config.cars.trips,
          ) * 10,
        ) / 10
      : 0,
    busy: carBusy(row, now),
    trip: trip ? tripDto(trip, now, config, locale) : null,
    listing,
    plateChangeAt: plateChangeAvailableAt(row.plateChangedAt, now, config.cars)?.toISOString() ?? null,
    badges,
    acquiredAt: row.acquiredAt.toISOString(),
  };
}

/** Машины игроков, сгруппированные по владельцу (нужны для комбо «Своя серия»). */
export async function loadGarages(db: PrismaClient | Tx, ownerIds: string[]): Promise<Map<string, CarRow[]>> {
  const ids = [...new Set(ownerIds)];
  const rows = ids.length
    ? await db.userCar.findMany({ where: { ownerId: { in: ids } }, include: CAR_INCLUDE, orderBy: { acquiredAt: 'asc' } })
    : [];
  const map = new Map<string, CarRow[]>(ids.map((id) => [id, []]));
  for (const r of rows) map.get(r.ownerId!)!.push(r);
  return map;
}

/** DTO произвольных машин (рынок, выставка): комбо считаются по гаражу их владельцев. */
export async function carDtosFor(
  db: PrismaClient | Tx,
  rows: CarRow[],
  config: GameConfig,
  now: Date,
  locale: Locale,
): Promise<Map<string, CarDto>> {
  const garages = await loadGarages(db, rows.map((r) => r.ownerId).filter((x): x is string => x !== null));
  return new Map(rows.map((r) => [r.id, carDto(r, r.ownerId ? garages.get(r.ownerId)! : [r], config, now, locale)]));
}

export function garageSlotsDto(user: Pick<User, 'extraGarageSlots'>, used: number, config: GameConfig): GarageSlotsDto {
  const g = config.cars.garage;
  const slots = Math.min(g.maxSlots, g.baseSlots + user.extraGarageSlots);
  return { used, slots, maxSlots: g.maxSlots, nextSlot: garageSlotPrice(slots, g) };
}

/** Проверяет, что в гараже есть свободное место. Пользователь должен быть заблокирован. */
export async function assertGarageSpace(tx: Tx, userId: string, config: GameConfig): Promise<void> {
  const [user, used] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { extraGarageSlots: true } }),
    tx.userCar.count({ where: { ownerId: userId } }),
  ]);
  if (used >= garageSlotsDto(user, used, config).slots) {
    throw new AppError(409, 'garage_full', 'В гараже нет свободных мест');
  }
}

export function defaultCarColor(config: GameConfig): string {
  return config.cars.tuning.palette[0]!;
}

export function newCarTuning(config: GameConfig, color?: string): CarTuning {
  const palette = config.cars.tuning.palette;
  return stockTuning(color && palette.includes(color) ? color : defaultCarColor(config));
}

/**
 * Стоимость коллекций игроков для рейтинга: номера, которые не висят на машинах,
 * плюс стоимость машин (цена модели + ценность номера × комбо).
 */
export async function collectionValues(
  prisma: PrismaClient,
  config: GameConfig,
  userIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(userIds)];
  const result = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0) return result;
  const plates = await prisma.plate.groupBy({
    by: ['ownerId'],
    where: { ownerId: { in: ids }, car: { is: null } },
    _sum: { value: true },
  });
  for (const p of plates) result.set(p.ownerId!, p._sum.value ?? 0);

  const garages = await loadGarages(prisma, ids);
  for (const [ownerId, rows] of garages) {
    const cars = rows.map(garageCarOf);
    const value = cars.reduce((s, c) => s + evaluateCar(c, cars, config.cars).value, 0);
    result.set(ownerId, result.get(ownerId)! + value);
  }
  return result;
}
