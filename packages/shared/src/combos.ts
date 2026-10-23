import type { CarsConfig, CombosConfig, GarageConfig } from './car-config';
import { styleNumbersOf, type CarModel, type CarStats, type CarTuning } from './cars';
import type { Plate } from './plate';
import type { Tier } from './rarity';
import { effectiveStats } from './tuning';

export const COMBO_IDS = ['status', 'style', 'series', 'mesalliance'] as const;
export type ComboId = (typeof COMBO_IDS)[number];

/** Номер, висящий на машине. value — ценность номера (plateValue). */
export interface MountedPlate {
  plate: Plate;
  tier: Tier;
  value: number;
}

/** Машина игрока в том виде, который нужен для расчёта комбо и стоимости. */
export interface GarageCar {
  id: string;
  model: CarModel;
  tuning: CarTuning;
  plate: MountedPlate | null;
}

/** Ключ буквенной серии номера: А***АА → "ААА". */
export function plateSeries(plate: Plate): string {
  return plate.letters;
}

/** Машины гаража, сгруппированные по буквенной серии висящих на них номеров. */
export function seriesGroups(garage: readonly GarageCar[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const car of garage) {
    if (!car.plate) continue;
    const key = plateSeries(car.plate.plate);
    groups.set(key, [...(groups.get(key) ?? []), car.id]);
  }
  return groups;
}

/** Размер самой большой серии в гараже — для заданий «собери серию». */
export function largestSeries(garage: readonly GarageCar[]): number {
  let best = 0;
  for (const ids of seriesGroups(garage).values()) best = Math.max(best, ids.length);
  return best;
}

/** Активные комбо машины. `garage` — все машины игрока (нужны для «Своей серии»), включая эту. */
export function carCombos(car: GarageCar, garage: readonly GarageCar[], cfg: CombosConfig): ComboId[] {
  const mounted = car.plate;
  if (!mounted) return [];
  const combos: ComboId[] = [];
  const cls = car.model.class;

  if (mounted.tier === cfg.status.tierByClass[cls]) combos.push('status');
  if (styleNumbersOf(car.model).includes(mounted.plate.number)) combos.push('style');

  const series = plateSeries(mounted.plate);
  const sameSeries = garage.filter((c) => c.plate && plateSeries(c.plate.plate) === series).length;
  if (sameSeries >= cfg.series.minCars) combos.push('series');

  if (cls === cfg.mesalliance.carClass && mounted.tier === cfg.mesalliance.tier) combos.push('mesalliance');
  return combos;
}

/** Итоговые множители комбо: эффекты перемножаются. */
export function comboMultipliers(combos: readonly ComboId[], cfg: CombosConfig): { income: number; prestige: number } {
  let income = 1;
  let prestige = 1;
  for (const id of combos) {
    income *= cfg[id].income;
    prestige *= cfg[id].prestige;
  }
  return { income, prestige };
}

/** Стоимость машины в рейтинге коллекций: цена модели + ценность номера × комбо-множитель престижа. */
export function carValue(modelPrice: number, plateValue: number | null, prestigeMultiplier: number): number {
  return modelPrice + Math.round((plateValue ?? 0) * prestigeMultiplier);
}

export interface CarEvaluation {
  combos: ComboId[];
  multipliers: { income: number; prestige: number };
  /** Характеристики с тюнингом, без комбо. */
  stats: CarStats;
  /** Престиж с тюнингом и комбо — то, что видно в карточке (может превышать 100). */
  prestige: number;
  value: number;
}

/** Полный расчёт машины: комбо, характеристики и стоимость. */
export function evaluateCar(car: GarageCar, garage: readonly GarageCar[], cfg: CarsConfig): CarEvaluation {
  const combos = carCombos(car, garage, cfg.combos);
  const multipliers = comboMultipliers(combos, cfg.combos);
  const stats = effectiveStats(car.model, car.tuning, cfg.tuning);
  return {
    combos,
    multipliers,
    stats,
    prestige: Math.round(stats.prestige * multipliers.prestige),
    value: carValue(car.model.priceChips, car.plate?.value ?? null, multipliers.prestige),
  };
}

/** Сколько система платит за машину. Номер, если висит, остаётся у игрока. */
export function carSellBackPrice(model: Pick<CarModel, 'priceChips'>, cfg: Pick<CarsConfig, 'sellBackPercent'>): number {
  return Math.floor((model.priceChips * cfg.sellBackPercent) / 100);
}

/**
 * Цена следующего места в гараже, когда у игрока `currentSlots` мест.
 * null — достигнут максимум.
 */
export function garageSlotPrice(currentSlots: number, cfg: GarageConfig): { chips: number; stars: number } | null {
  if (currentSlots >= cfg.maxSlots) return null;
  const bought = Math.max(0, currentSlots - cfg.baseSlots);
  return {
    chips: Math.round(cfg.slotPriceChips * cfg.slotPriceGrowth ** bought),
    stars: cfg.slotPriceStars,
  };
}

/** Когда на машине снова можно сменить номер; null — можно сейчас. */
export function plateChangeAvailableAt(
  lastChangeAt: Date | null,
  now: Date,
  cfg: Pick<CarsConfig, 'plateMount'>,
): Date | null {
  if (!lastChangeAt) return null;
  const at = new Date(lastChangeAt.getTime() + cfg.plateMount.cooldownHours * 3_600_000);
  return at.getTime() > now.getTime() ? at : null;
}
