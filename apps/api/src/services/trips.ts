import {
  carModelTitle,
  evaluateCar,
  formatPlate,
  rollTripEvent,
  settleTrip,
  tripBaseIncome,
  tripEndsAt,
  tripHourlyIncome,
  type CarDto,
} from '@nomer/shared';
import type { Prisma } from '@prisma/client';
import { afterCommit, type AppContext } from '../context';
import { assertCarIdle, carDto, garageCarOf, loadGarages, lockOwnedCar, modelFromRow } from '../lib/cars';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { AppError, badRequest } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { cryptoRng } from '../lib/rng';
import { trackQuest } from './quests';

/**
 * Начисляет доход вернувшихся машин и освобождает их. Деньги получает тот,
 * кто отправил машину, даже если она с тех пор сменила владельца.
 */
export async function collectFinishedTrips(
  tx: Tx,
  scope: { userId: string } | { carIds: string[] },
  now: Date,
): Promise<{ trips: number; income: number }> {
  const where: Prisma.CarTripWhereInput = {
    status: 'active',
    endsAt: { lte: now },
    ...('userId' in scope ? { userId: scope.userId } : { carId: { in: scope.carIds } }),
  };
  const candidates = await tx.carTrip.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } });
  let income = 0;
  let trips = 0;
  for (const { id } of candidates) {
    // Повторная проверка под блокировкой: параллельный сбор не начислит доход дважды.
    const locked = await tx.$queryRaw<{ id: string; userId: string; income: number }[]>`
      SELECT id, "userId", income FROM "CarTrip" WHERE id = ${id} AND status = 'active' FOR UPDATE`;
    const trip = locked[0];
    if (!trip) continue;
    await tx.carTrip.update({ where: { id }, data: { status: 'collected', activeCarId: null, collectedAt: now } });
    await changeBalance(tx, { userId: trip.userId, currency: 'chips', delta: trip.income, reason: 'trip_income', refId: id });
    income += trip.income;
    trips++;
  }
  return { trips, income };
}

export async function collectTrips(ctx: AppContext, userId: string) {
  const now = ctx.now();
  return withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const result = await collectFinishedTrips(tx, { userId }, now);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return { ...result, chips: user.chips };
  });
}

/** Отправить машину с номером на покатушки на `hours` часов. */
export async function startTrip(ctx: AppContext, userId: string, carId: string, hours: number): Promise<CarDto> {
  const { config } = await ctx.config.get();
  const trips = config.cars.trips;
  if (!trips.durations.some((d) => d.hours === hours)) {
    throw badRequest(`Длительность покатушек: ${trips.durations.map((d) => d.hours).join(', ')} ч`);
  }
  const now = ctx.now();

  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    await collectFinishedTrips(tx, { carIds: [carId] }, now);
    const car = await lockOwnedCar(tx, carId, userId);
    assertCarIdle(car, now);
    if (!car.plate) throw new AppError(409, 'no_plate', 'Покатушки только с номером — повесьте номер на машину');

    const garage = (await loadGarages(tx, [userId])).get(userId)!;
    const e = evaluateCar(garageCarOf(car), garage.map(garageCarOf), config.cars);
    const hourly = tripHourlyIncome(
      { prestige: e.stats.prestige, tier: car.plate.tier, incomeMultiplier: e.multipliers.income },
      trips,
    );
    const base = tripBaseIncome(hourly, hours, trips)!;
    const event = rollTripEvent(cryptoRng, garageCarOf(car).tuning, trips);
    const settled = settleTrip(base, event);
    const endsAt = tripEndsAt(now, hours);

    const trip = await tx.carTrip.create({
      data: {
        carId,
        userId,
        hours,
        startedAt: now,
        endsAt,
        baseIncome: base,
        eventId: settled.eventId,
        income: settled.total,
        activeCarId: carId,
      },
    });
    await trackQuest(tx, config, userId, 'trip_start', { at: now, tier: car.plate.tier, carClass: car.model.class });

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const fresh = (await loadGarages(tx, [userId])).get(userId)!;
    const dto = carDto(fresh.find((c) => c.id === carId)!, fresh, config, now, user.locale === 'en' ? 'en' : 'ru');
    const title = `${carModelTitle(modelFromRow(car.model))} · ${formatPlate(car.plate)}`;
    return { dto, user, trip, title, event };
  });

  const { trip, event } = result;
  await afterCommit(
    ctx,
    ctx.notifier.send(
      result.user,
      { type: 'trip_returned', car: result.title, income: trip.income, event: event ? event.title : null },
      { delayMs: trip.endsAt.getTime() - now.getTime(), jobId: `trip-${trip.id}` },
    ),
  );
  return result.dto;
}
