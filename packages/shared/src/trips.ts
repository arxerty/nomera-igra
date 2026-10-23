import type { TripEventConfig, TripsConfig } from './car-config';
import type { CarTuning } from './cars';
import type { Rng } from './generator';
import type { Tier } from './rarity';

const HOUR = 3_600_000;

/**
 * Почасовой доход покатушек: престиж с тюнингом (без комбо) × редкость номера × комбо-множитель
 * дохода. Комбо здесь учитываются один раз — через множитель дохода, а не ещё и через престиж.
 */
export function tripHourlyIncome(
  car: { prestige: number; tier: Tier; incomeMultiplier: number },
  cfg: TripsConfig,
): number {
  return car.prestige * cfg.chipsPerPrestigeHour * cfg.tierIncome[car.tier] * car.incomeMultiplier;
}

/** Доход за поездку без учёта события. null — такой длительности нет в конфиге. */
export function tripBaseIncome(hourly: number, hours: number, cfg: TripsConfig): number | null {
  const duration = cfg.durations.find((d) => d.hours === hours);
  if (!duration) return null;
  return Math.round(hourly * hours * duration.efficiency);
}

export function tripEndsAt(startedAt: Date, hours: number): Date {
  return new Date(startedAt.getTime() + hours * HOUR);
}

function conditionHolds(event: TripEventConfig, tuning: Pick<CarTuning, 'tint' | 'underglow'>): boolean {
  switch (event.condition) {
    case undefined:
      return true;
    case 'no_tint':
      return tuning.tint === 0;
    case 'underglow':
      return tuning.underglow !== null;
  }
}

/**
 * Случайное событие поездки. Сначала выбирается исход по весам из всего списка,
 * затем проверяется условие: тонированная машина просто не ловит камеру —
 * шансы остальных событий от тюнинга не меняются. null — поездка без происшествий.
 */
export function rollTripEvent(
  rng: Rng,
  tuning: Pick<CarTuning, 'tint' | 'underglow'>,
  cfg: TripsConfig,
): TripEventConfig | null {
  const total = cfg.noEventWeight + cfg.events.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let r = rng.int(total);
  if (r < cfg.noEventWeight) return null;
  r -= cfg.noEventWeight;
  for (const e of cfg.events) {
    if (r < e.weight) return conditionHolds(e, tuning) ? e : null;
    r -= e.weight;
  }
  return null;
}

export interface TripSettlement {
  base: number;
  eventId: string | null;
  /** Прибавка (или штраф со знаком минус) от события. */
  eventDelta: number;
  total: number;
}

export function settleTrip(base: number, event: Pick<TripEventConfig, 'id' | 'incomeMultiplier'> | null): TripSettlement {
  const total = event ? Math.max(0, Math.round(base * event.incomeMultiplier)) : base;
  return { base, eventId: event?.id ?? null, eventDelta: total - base, total };
}
