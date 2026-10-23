import type { ExhibitionConfig } from './car-config';
import type { Rng } from './generator';

const DAY = 86_400_000;

/** Голос только у аккаунтов старше N дней и с минимальным прогрессом — защита от накрутки. */
export function canVoteInExhibition(
  voter: { createdAt: Date; rollsTotal: number },
  now: Date,
  cfg: ExhibitionConfig,
): boolean {
  const ageDays = (now.getTime() - voter.createdAt.getTime()) / DAY;
  return ageDays >= cfg.minAccountAgeDays && voter.rollsTotal >= cfg.minRollsTotal;
}

/**
 * Оценка машины по попарным голосованиям: нижняя граница доверительного
 * интервала Уилсона (95%) для доли побед. Машина с 3 из 3 не обгоняет машину с 90 из 100.
 */
export function exhibitionScore(wins: number, shows: number): number {
  if (shows <= 0) return 0;
  const z = 1.96;
  const p = wins / shows;
  const z2 = z * z;
  const center = p + z2 / (2 * shows);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * shows)) / shows);
  return (center - margin) / (1 + z2 / shows);
}

export interface ExhibitionEntryStats {
  id: string;
  wins: number;
  shows: number;
}

/**
 * Итоговая таблица выставки. Машины с показами меньше minShows в призы не попадают
 * и идут после остальных. Порядок при равенстве: больше показов, затем id — стабильно.
 */
export function rankExhibition(
  entries: readonly ExhibitionEntryStats[],
  cfg: ExhibitionConfig,
): (ExhibitionEntryStats & { score: number; place: number | null })[] {
  const scored = entries.map((e) => ({ ...e, score: exhibitionScore(e.wins, e.shows) }));
  const qualified = (e: ExhibitionEntryStats) => e.shows >= cfg.minShows;
  scored.sort(
    (a, b) =>
      Number(qualified(b)) - Number(qualified(a)) ||
      b.score - a.score ||
      b.shows - a.shows ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let place = 0;
  return scored.map((e) => ({ ...e, place: qualified(e) ? ++place : null }));
}

export function exhibitionPrize(place: number | null, cfg: ExhibitionConfig) {
  return place === null ? null : (cfg.prizes[place - 1] ?? null);
}

/**
 * Пара машин для голосования «какая круче?». Из чужих машин каждая позиция
 * выбирается как наименее показанная из трёх случайных — так показы выравниваются.
 * null — меньше двух машин для показа.
 */
export function pickVotePair(
  entries: readonly ExhibitionEntryStats[],
  excludeIds: ReadonlySet<string>,
  rng: Rng,
): [string, string] | null {
  const pool = entries.filter((e) => !excludeIds.has(e.id));
  if (pool.length < 2) return null;
  const pickOne = (from: readonly ExhibitionEntryStats[]) => {
    let best = from[rng.int(from.length)]!;
    for (let i = 0; i < 2; i++) {
      const c = from[rng.int(from.length)]!;
      if (c.shows < best.shows) best = c;
    }
    return best;
  };
  const first = pickOne(pool);
  const second = pickOne(pool.filter((e) => e.id !== first.id));
  return rng.int(2) === 0 ? [first.id, second.id] : [second.id, first.id];
}
