/**
 * Машины: классы, характеристики, модели и тюнинг экземпляра.
 * Все марки и модели вымышленные — узнаются только по типажу.
 */

export const CAR_CLASSES = ['economy', 'comfort', 'business', 'premium', 'luxury', 'collectible'] as const;
export type CarClass = (typeof CAR_CLASSES)[number];

export const CAR_CLASS_RANK: Record<CarClass, number> = {
  economy: 0,
  comfort: 1,
  business: 2,
  premium: 3,
  luxury: 4,
  collectible: 5,
};

export function isCarClassAtLeast(cls: CarClass, min: CarClass): boolean {
  return CAR_CLASS_RANK[cls] >= CAR_CLASS_RANK[min];
}

export const CAR_STATS = ['speed', 'acceleration', 'handling', 'prestige'] as const;
export type CarStat = (typeof CAR_STATS)[number];
export type CarStats = Record<CarStat, number>;

/** Потолок характеристики после тюнинга (престиж с комбо может быть выше). */
export const MAX_STAT = 100;

export const CAR_ARCHETYPES = [
  'soviet_classic',
  'people_sedan',
  'comfort_sedan',
  'crossover',
  'business_sedan',
  'german_crossover',
  'sports_car',
  'offroad_gelik',
  'limousine',
] as const;
export type CarArchetype = (typeof CAR_ARCHETYPES)[number];

/** Как модель попадает в салон: всегда, в суточной ротации или ограниченным тиражом. */
export const SHOWROOM_MODES = ['always', 'rotating', 'limited'] as const;
export type ShowroomMode = (typeof SHOWROOM_MODES)[number];

export interface CarModel {
  id: string;
  brand: string;
  name: string;
  year: number;
  class: CarClass;
  archetype: CarArchetype;
  stats: CarStats;
  /** Цена в Фишках; она же базовая стоимость машины в рейтинге. */
  priceChips: number;
  /** Альтернативная цена в Stars (премиум-модели). */
  priceStars?: number;
  showroom: ShowroomMode;
  /** Тираж на всю игру — только для showroom 'limited'. */
  editionSize?: number;
  /** Цифры номера для комбо «Стиль»; если не заданы — берутся из названия и года. */
  styleNumbers?: number[];
  /** Сезонная модель: продаётся только в этот игровой месяц ("2026-12"). */
  season?: string;
}

export function carModelTitle(m: Pick<CarModel, 'brand' | 'name'>): string {
  return `${m.brand} ${m.name}`;
}

/**
 * Цифры номера, совпадающие с моделью: числа из названия (длинные — по последним
 * трём цифрам) и год — двумя и тремя последними цифрами. «Рассвет 412» 1969 → 412, 69, 969.
 */
export function styleNumbersOf(m: Pick<CarModel, 'name' | 'year' | 'styleNumbers'>): number[] {
  if (m.styleNumbers) return [...m.styleNumbers];
  const fromName = (m.name.match(/\d+/g) ?? []).map((d) => Number(d.slice(-3)));
  const numbers = [...fromName, m.year % 100, m.year % 1000];
  return [...new Set(numbers.filter((n) => n >= 1 && n <= 999))];
}

export const PAINT_FINISHES = ['gloss', 'metallic', 'pearl', 'matte', 'chameleon', 'exclusive'] as const;
export type PaintFinish = (typeof PAINT_FINISHES)[number];

export interface CarPaint {
  finish: PaintFinish;
  /** Цвет "#RRGGBB"; для finish 'exclusive' — id эксклюзивной окраски из конфига. */
  color: string;
}

export interface CarTuning {
  paint: CarPaint;
  /** 0 — заводские диски, 1..N — варианты из конфига. */
  wheels: number;
  /** Уровень тонировки, 0 — без тонировки. */
  tint: number;
  /** 0 — заводской обвес, 1..N — варианты. */
  bodykit: number;
  /** Цвет подсветки днища; null — нет подсветки. */
  underglow: string | null;
  engine: number;
  suspension: number;
}

export function stockTuning(color: string): CarTuning {
  return {
    paint: { finish: 'gloss', color },
    wheels: 0,
    tint: 0,
    bodykit: 0,
    underglow: null,
    engine: 0,
    suspension: 0,
  };
}
