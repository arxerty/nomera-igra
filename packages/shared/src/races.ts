import type { RacesConfig } from './car-config';
import type { CarStats } from './cars';
import type { Rng } from './generator';

/** Рейтинг машины для дрэга и подбора соперника: взвешенная сумма ходовых характеристик. */
export function raceRating(stats: Pick<CarStats, 'speed' | 'acceleration' | 'handling'>, cfg: RacesConfig): number {
  const w = cfg.weights;
  return stats.speed * w.speed + stats.acceleration * w.acceleration + stats.handling * w.handling;
}

/** Допустимая разница рейтингов после `waitSeconds` ожидания в очереди. */
export function matchmakingGap(waitSeconds: number, cfg: RacesConfig): number {
  const mm = cfg.matchmaking;
  return Math.min(mm.maxGap, mm.baseGap + Math.floor(Math.max(0, waitSeconds) / 15) * mm.gapPer15s);
}

export function canMatch(ratingA: number, ratingB: number, waitSeconds: number, cfg: RacesConfig): boolean {
  return Math.abs(ratingA - ratingB) <= matchmakingGap(waitSeconds, cfg);
}

/** Время заезда: машина с рейтингом 100 проезжает за baseTimeMs, вдвое слабее — в √2 раза дольше. */
function raceTimeMs(performance: number, cfg: RacesConfig): number {
  return Math.round(cfg.baseTimeMs * Math.sqrt(100 / Math.max(1, performance)));
}

export interface RaceResult {
  winner: 'a' | 'b';
  /** Время заезда для анимации на клиенте; у победителя всегда меньше. */
  timeA: number;
  timeB: number;
}

/**
 * Исход дрэг-заезда. Каждой машине рейтинг умножается на случайный фактор
 * в пределах ±randomness; побеждает большее значение. Считается только на сервере.
 */
export function resolveRace(
  a: Pick<CarStats, 'speed' | 'acceleration' | 'handling'>,
  b: Pick<CarStats, 'speed' | 'acceleration' | 'handling'>,
  rng: Rng,
  cfg: RacesConfig,
): RaceResult {
  const noise = () => ((rng.int(2001) - 1000) / 1000) * cfg.randomness;
  const perfA = raceRating(a, cfg) * (1 + noise());
  const perfB = raceRating(b, cfg) * (1 + noise());
  let timeA = raceTimeMs(perfA, cfg);
  let timeB = raceTimeMs(perfB, cfg);

  let winner: 'a' | 'b';
  if (timeA !== timeB) winner = timeA < timeB ? 'a' : 'b';
  else winner = rng.int(2) === 0 ? 'a' : 'b';
  // Фотофиниш: время различается хотя бы на миллисекунду, чтобы анимация не спорила с итогом.
  if (timeA === timeB) {
    if (winner === 'a') timeB += 1;
    else timeA += 1;
  }
  return { winner, timeA, timeB };
}

/** Ставка 0 — заезд без ставки. */
export function isValidRaceBet(bet: number, cfg: RacesConfig): boolean {
  return bet === 0 || (Number.isInteger(bet) && bet >= cfg.minBet && bet <= cfg.maxBet);
}

/** Оба ставят `bet`; победитель забирает банк за вычетом комиссии. */
export function raceBetSettlement(bet: number, feePercent: number) {
  const pot = bet * 2;
  const fee = Math.floor((pot * feePercent) / 100);
  return { pot, fee, winnerReceives: pot - fee };
}

export function racesLeftToday(usedToday: number, cfg: RacesConfig): number {
  return Math.max(0, cfg.dailyLimit - usedToday);
}
