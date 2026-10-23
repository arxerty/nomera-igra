import type { CarModel } from './cars';
import { createSeededRng } from './generator';

/** 32-битный FNV-1a: превращает ключ суток в зерно ротации. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Сколько экземпляров коллекционной модели ещё можно купить. */
export function editionLeft(model: Pick<CarModel, 'editionSize'>, sold: number): number | null {
  return model.editionSize === undefined ? null : Math.max(0, model.editionSize - sold);
}

/**
 * Ассортимент салона на игровые сутки `dayKey`: постоянные модели, `rotatingSlots`
 * моделей из ротации (одинаковые для всех игроков в течение суток) и коллекционные,
 * пока не распродан тираж. `sold` — сколько экземпляров каждой модели уже продано.
 * Сезонные модели показываются только в свой сезон (игровой месяц из dayKey).
 */
export function showroomForDay(
  allModels: readonly CarModel[],
  dayKey: string,
  rotatingSlots: number,
  sold: ReadonlyMap<string, number> = new Map(),
): CarModel[] {
  const season = dayKey.slice(0, 7);
  const models = allModels.filter((m) => m.season === undefined || m.season === season);
  const rotating = models.filter((m) => m.showroom === 'rotating');
  const rng = createSeededRng(hashString(`showroom:${dayKey}`));
  // Частичная перетасовка Фишера — Йейтса: первые rotatingSlots элементов — выбор дня.
  const pool = [...rotating];
  const take = Math.min(rotatingSlots, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + rng.int(pool.length - i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const todays = new Set(pool.slice(0, take).map((m) => m.id));

  return models.filter((m) => {
    switch (m.showroom) {
      case 'always':
        return true;
      case 'rotating':
        return todays.has(m.id);
      case 'limited':
        return (editionLeft(m, sold.get(m.id) ?? 0) ?? 0) > 0;
    }
  });
}
