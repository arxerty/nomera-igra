import { describe, expect, it } from 'vitest';
import {
  CAR_CLASSES,
  CAR_CLASS_RANK,
  DEFAULT_CAR_MODELS,
  DEFAULT_GAME_CONFIG,
  TIER_RANK,
  carCatalogSchema,
  gameConfigSchema,
  styleNumbersOf,
} from '../src';

describe('каталог машин', () => {
  it('проходит валидацию', () => {
    expect(carCatalogSchema.safeParse(DEFAULT_CAR_MODELS).success).toBe(true);
  });

  it('в каждом классе есть модели', () => {
    for (const cls of CAR_CLASSES) {
      expect(DEFAULT_CAR_MODELS.some((m) => m.class === cls)).toBe(true);
    }
  });

  it('без реальных марок', () => {
    const real = /лада|ваз|жигул|волга|москвич|газ|bmw|бмв|мерседес|mercedes|audi|ауди|porsche|порше|ferrari|феррари|lamborghini|toyota|тойота|hyundai|хёндай|kia|киа|аурус|aurus|чайка|победа/i;
    for (const m of DEFAULT_CAR_MODELS) expect(`${m.brand} ${m.name}`).not.toMatch(real);
  });

  it('класс выше — самая дешёвая модель не дешевле самой дорогой классом ниже', () => {
    for (let i = 1; i < CAR_CLASSES.length; i++) {
      const prices = (cls: string) => DEFAULT_CAR_MODELS.filter((m) => m.class === cls).map((m) => m.priceChips);
      expect(Math.min(...prices(CAR_CLASSES[i]!))).toBeGreaterThanOrEqual(Math.max(...prices(CAR_CLASSES[i - 1]!)));
    }
  });

  it('коллекционные модели продаются только ограниченным тиражом', () => {
    for (const m of DEFAULT_CAR_MODELS.filter((x) => x.class === 'collectible')) {
      expect(m.showroom).toBe('limited');
      expect(m.editionSize).toBeGreaterThan(0);
    }
  });

  it('схема ловит тираж у обычной модели и дубли id', () => {
    const base = DEFAULT_CAR_MODELS[0]!;
    expect(carCatalogSchema.safeParse([{ ...base, editionSize: 10 }]).success).toBe(false);
    expect(carCatalogSchema.safeParse([base, base]).success).toBe(false);
  });
});

describe('styleNumbersOf', () => {
  it('берёт числа из названия и год', () => {
    expect(styleNumbersOf({ name: '412', year: 1969 })).toEqual([412, 69, 969]);
  });

  it('длинное число из названия — по последним трём цифрам', () => {
    expect(styleNumbersOf({ name: '2101', year: 1970 })).toEqual([101, 70, 970]);
  });

  it('без цифр в названии — только год, без дублей и нулей', () => {
    expect(styleNumbersOf({ name: 'Гранит', year: 2018 })).toEqual([18]);
    expect(styleNumbersOf({ name: 'Икс', year: 2000 })).toEqual([]);
  });

  it('явный список заменяет вывод', () => {
    expect(styleNumbersOf({ name: 'Ахт', year: 2018, styleNumbers: [8, 888] })).toEqual([8, 888]);
  });
});

describe('конфиг машин', () => {
  const { cars, races } = DEFAULT_GAME_CONFIG;

  it('дефолтный конфиг проходит валидацию', () => {
    expect(gameConfigSchema.safeParse(DEFAULT_GAME_CONFIG).success).toBe(true);
  });

  it('«Статус»: класс выше требует номер не ниже', () => {
    const tiers = CAR_CLASSES.map((c) => TIER_RANK[cars.combos.status.tierByClass[c]]);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1]!);
  });

  it('призы турнира ссылаются на существующие эксклюзивные окраски', () => {
    const ids = new Set(cars.tuning.exclusivePaints.map((p) => p.id));
    for (const p of races.tournament.prizes) if (p.paint) expect(ids).toContain(p.paint);
  });

  it('множитель цены тюнинга растёт с классом', () => {
    const sorted = [...CAR_CLASSES].sort((a, b) => CAR_CLASS_RANK[a] - CAR_CLASS_RANK[b]);
    for (let i = 1; i < sorted.length; i++) {
      expect(cars.tuning.classCostMultiplier[sorted[i]!]).toBeGreaterThan(cars.tuning.classCostMultiplier[sorted[i - 1]!]);
    }
  });

  it('отклоняет кривые веса гонок и streak без срыва серии', () => {
    const badRaces = { ...races, weights: { speed: 0.5, acceleration: 0.5, handling: 0.5 } };
    expect(gameConfigSchema.safeParse({ ...DEFAULT_GAME_CONFIG, races: badRaces }).success).toBe(false);
    const badQuest = { ...DEFAULT_GAME_CONFIG.quests[0]!, id: 'x', mode: 'streak' as const };
    expect(
      gameConfigSchema.safeParse({ ...DEFAULT_GAME_CONFIG, quests: [...DEFAULT_GAME_CONFIG.quests, badQuest] }).success,
    ).toBe(false);
  });
});
