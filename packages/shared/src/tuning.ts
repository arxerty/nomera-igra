import type { TuningConfig } from './car-config';
import { MAX_STAT, type CarClass, type CarModel, type CarStats, type CarTuning, type PaintFinish } from './cars';

export type TuningError =
  | 'unknown_color'
  | 'unknown_exclusive_paint'
  | 'wheels_out_of_range'
  | 'bodykit_out_of_range'
  | 'tint_out_of_range'
  | 'unknown_underglow'
  | 'engine_out_of_range'
  | 'suspension_out_of_range';

/** Проверяет, что тюнинг собран из того, что есть в конфиге. Возвращает первую ошибку или null. */
export function validateTuning(t: CarTuning, cfg: TuningConfig): TuningError | null {
  const inRange = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
  if (t.paint.finish === 'exclusive') {
    if (!cfg.exclusivePaints.some((p) => p.id === t.paint.color)) return 'unknown_exclusive_paint';
  } else if (!cfg.palette.includes(t.paint.color)) {
    return 'unknown_color';
  }
  if (!inRange(t.wheels, cfg.wheels.variants)) return 'wheels_out_of_range';
  if (!inRange(t.bodykit, cfg.bodykit.variants)) return 'bodykit_out_of_range';
  if (!inRange(t.tint, cfg.tint.maxLevel)) return 'tint_out_of_range';
  if (t.underglow !== null && !cfg.underglow.colors.includes(t.underglow)) return 'unknown_underglow';
  if (!inRange(t.engine, cfg.engine.maxLevel)) return 'engine_out_of_range';
  if (!inRange(t.suspension, cfg.suspension.maxLevel)) return 'suspension_out_of_range';
  return null;
}

const clampStat = (v: number) => Math.min(MAX_STAT, Math.round(v));

/** Характеристики машины с учётом тюнинга (без комбо). */
export function effectiveStats(model: Pick<CarModel, 'stats'>, t: CarTuning, cfg: TuningConfig): CarStats {
  const { stats } = model;
  const prestigeBonus =
    cfg.paintPrestige[t.paint.finish] +
    (t.wheels > 0 ? cfg.wheels.prestige : 0) +
    (t.bodykit > 0 ? cfg.bodykit.prestige : 0) +
    (t.underglow !== null ? cfg.underglow.prestige : 0);
  return {
    speed: clampStat(stats.speed + t.engine * cfg.engine.speedPerLevel),
    acceleration: clampStat(stats.acceleration + t.engine * cfg.engine.accelerationPerLevel),
    handling: clampStat(stats.handling + t.suspension * cfg.suspension.handlingPerLevel),
    prestige: clampStat(stats.prestige + prestigeBonus),
  };
}

/** Цена одного уровня доработки двигателя или подвески. */
export function upgradeLevelCost(
  part: 'engine' | 'suspension',
  level: number,
  carClass: CarClass,
  cfg: TuningConfig,
): number {
  const u = cfg[part];
  return Math.round(u.baseCost * u.costGrowth ** (level - 1) * cfg.classCostMultiplier[carClass]);
}

export interface PaintPrice {
  chips: number;
  /** Альтернативная цена в Stars, если покраску можно купить и так. */
  stars: number | null;
}

export function paintPrice(finish: PaintFinish, cfg: TuningConfig): PaintPrice {
  const stars = cfg.paintStars[finish];
  return { chips: cfg.paintChips[finish], stars: stars > 0 ? stars : null };
}

export type TuningPlanError = TuningError | 'downgrade';

/**
 * Сколько Фишек стоит перейти от текущего тюнинга к желаемому.
 * Платятся только изменённые позиции; возврат к заводским дискам, обвесу,
 * снятие тонировки и подсветки бесплатны. Двигатель и подвеску откатывать нельзя.
 * Эксклюзивная окраска бесплатна, но доступна только тем, кому её выдали, — это проверяет сервер.
 */
export function tuningCost(
  carClass: CarClass,
  from: CarTuning,
  to: CarTuning,
  cfg: TuningConfig,
): { ok: true; chips: number } | { ok: false; error: TuningPlanError } {
  const invalid = validateTuning(to, cfg);
  if (invalid) return { ok: false, error: invalid };
  if (to.engine < from.engine || to.suspension < from.suspension) return { ok: false, error: 'downgrade' };

  let chips = 0;
  if (to.paint.finish !== from.paint.finish || to.paint.color !== from.paint.color) {
    chips += cfg.paintChips[to.paint.finish];
  }
  if (to.wheels !== from.wheels && to.wheels > 0) chips += cfg.wheels.costChips;
  if (to.bodykit !== from.bodykit && to.bodykit > 0) chips += cfg.bodykit.costChips;
  if (to.tint > from.tint) chips += (to.tint - from.tint) * cfg.tint.costPerLevel;
  if (to.underglow !== from.underglow && to.underglow !== null) chips += cfg.underglow.costChips;
  for (let lvl = from.engine + 1; lvl <= to.engine; lvl++) chips += upgradeLevelCost('engine', lvl, carClass, cfg);
  for (let lvl = from.suspension + 1; lvl <= to.suspension; lvl++) {
    chips += upgradeLevelCost('suspension', lvl, carClass, cfg);
  }
  return { ok: true, chips };
}
