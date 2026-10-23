import { z } from 'zod';
import { CAR_CLASSES, PAINT_FINISHES, type CarClass, type PaintFinish } from './cars';
import { TIERS, type Tier } from './rarity';

/**
 * Разделы игрового конфига для машин и связанных с ними режимов.
 * Собираются в gameConfigSchema (config.ts).
 */

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Цвет в формате #RRGGBB');
const configId = z.string().regex(/^[a-z0-9_]+$/);
const title = z.object({ ru: z.string().min(1), en: z.string().min(1) });
const multiplier = z.number().min(0.1).max(20);

const classRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(CAR_CLASSES.map((c) => [c, value])) as Record<CarClass, T>);

const tierRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(TIERS.map((t) => [t, value])) as Record<Tier, T>);

const finishRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(PAINT_FINISHES.map((f) => [f, value])) as Record<PaintFinish, T>);

/** Множители комбо: к доходу покатушек и к престижу (а через него — к стоимости машины). */
const comboEffect = z.object({ income: multiplier, prestige: multiplier });

/** Уровневая доработка: цена уровня k = baseCost × costGrowth^(k−1) × множитель класса. */
const levelUpgrade = z.object({
  maxLevel: z.number().int().min(1).max(20),
  baseCost: z.number().int().min(0),
  costGrowth: z.number().min(1).max(10),
});

export const carsConfigSchema = z.object({
  garage: z
    .object({
      baseSlots: z.number().int().min(1),
      maxSlots: z.number().int().min(1),
      /** Цена первого докупленного места; каждое следующее дороже в slotPriceGrowth раз. */
      slotPriceChips: z.number().int().min(0),
      slotPriceGrowth: z.number().min(1).max(10),
      slotPriceStars: z.number().int().min(1),
    })
    .refine((g) => g.maxSlots >= g.baseSlots, 'maxSlots не меньше baseSlots'),
  plateMount: z.object({
    /** «Госпошлина» за снятие номера с машины (в том числе при перевесе). */
    removeFeeChips: z.number().int().min(0),
    /** Сколько часов после смены номера на машине его нельзя снова менять. */
    cooldownHours: z.number().min(0).max(168),
  }),
  /** Сколько процентов цены модели система платит при выкупе машины (тюнинг не возвращается). */
  sellBackPercent: z.number().min(0).max(100),
  combos: z.object({
    status: comboEffect.extend({
      /** Редкость номера, которая «по статусу» машине этого класса. */
      tierByClass: classRecord(z.enum(TIERS)),
    }),
    style: comboEffect,
    series: comboEffect.extend({
      /** Сколько машин с номерами одной буквенной серии нужно для бонуса. */
      minCars: z.number().int().min(2).max(20),
    }),
    mesalliance: comboEffect.extend({
      carClass: z.enum(CAR_CLASSES),
      tier: z.enum(TIERS),
    }),
  }),
  tuning: z.object({
    /** Палитра для всех покрасок, кроме эксклюзивных. */
    palette: z.array(hexColor).min(1),
    paintChips: finishRecord(z.number().int().min(0)),
    /** Альтернативная цена покраски в Stars; 0 — только за Фишки. */
    paintStars: finishRecord(z.number().int().min(0)),
    paintPrestige: finishRecord(z.number().int().min(0).max(50)),
    /** Окраски-награды (турниры, сезоны): не продаются, выдаются сервером. */
    exclusivePaints: z.array(z.object({ id: configId, colors: z.array(hexColor).min(1).max(3), title })),
    wheels: z.object({ variants: z.number().int().min(1), costChips: z.number().int().min(0), prestige: z.number().int().min(0) }),
    bodykit: z.object({ variants: z.number().int().min(1), costChips: z.number().int().min(0), prestige: z.number().int().min(0) }),
    tint: z.object({ maxLevel: z.number().int().min(1).max(5), costPerLevel: z.number().int().min(0) }),
    underglow: z.object({ colors: z.array(hexColor).min(1), costChips: z.number().int().min(0), prestige: z.number().int().min(0) }),
    engine: levelUpgrade.extend({ speedPerLevel: z.number().min(0), accelerationPerLevel: z.number().min(0) }),
    suspension: levelUpgrade.extend({ handlingPerLevel: z.number().min(0) }),
    /** Множитель цены доработок двигателя и подвески по классу машины. */
    classCostMultiplier: classRecord(z.number().min(0.1).max(100)),
  }),
  trips: z.object({
    /** Длительности покатушек; efficiency — доля почасового дохода (длинные поездки чуть менее выгодны). */
    durations: z
      .array(z.object({ hours: z.number().int().min(1).max(24), efficiency: z.number().min(0.1).max(1) }))
      .min(1)
      .refine((d) => new Set(d.map((x) => x.hours)).size === d.length, 'Длительности не должны повторяться'),
    /** Фишек в час за единицу престижа. */
    chipsPerPrestigeHour: z.number().min(0),
    /** Множитель дохода от редкости номера на машине. */
    tierIncome: tierRecord(z.number().min(0)),
    /** Вес исхода «поездка без происшествий». */
    noEventWeight: z.number().int().min(0),
    events: z
      .array(
        z.object({
          id: configId,
          weight: z.number().int().min(0),
          incomeMultiplier: z.number().min(0).max(10),
          /** Событие срабатывает, только если машина подходит; иначе поездка без происшествий. */
          condition: z.enum(['no_tint', 'underglow']).optional(),
          title,
        }),
      )
      .refine((e) => new Set(e.map((x) => x.id)).size === e.length, 'id событий должны быть уникальны'),
  }),
  showroom: z.object({
    /** Сколько моделей из ротации показывается в салоне в течение игровых суток. */
    rotatingSlots: z.number().int().min(0),
  }),
});

export const racesConfigSchema = z.object({
  dailyLimit: z.number().int().min(1),
  /** Веса характеристик в рейтинге машины для дрэга; сумма — 1. */
  weights: z
    .object({ speed: z.number().min(0), acceleration: z.number().min(0), handling: z.number().min(0) })
    .refine((w) => Math.abs(w.speed + w.acceleration + w.handling - 1) < 1e-9, 'Сумма весов должна быть 1'),
  /** Случайный фактор заезда: ±доля от рейтинга. */
  randomness: z.number().min(0).max(0.5),
  /** Время заезда машины с рейтингом 100, мс. */
  baseTimeMs: z.number().int().min(1000),
  minBet: z.number().int().min(1),
  maxBet: z.number().int().min(1),
  /** Комиссия с банка ставок, удерживается с выигрыша. */
  betFeePercent: z.number().min(0).max(50),
  matchmaking: z.object({
    /** Допустимая разница рейтингов сразу после входа в очередь. */
    baseGap: z.number().min(0),
    /** На сколько расширяется окно за каждые 15 секунд ожидания. */
    gapPer15s: z.number().min(0),
    maxGap: z.number().min(0),
    /** Через сколько секунд без живого соперника игрок едет против «призрака» (без ставки). */
    ghostAfterSeconds: z.number().int().min(0),
    /** Заявка в очереди старше этого срока снимается, ставка возвращается. */
    queueTtlSeconds: z.number().int().min(10),
  }),
  tournament: z.object({
    /** Призы недельного турнира по местам (индекс 0 — первое место). */
    prizes: z.array(
      z.object({ chips: z.number().int().min(0), rolls: z.number().int().min(0), paint: configId.optional() }),
    ),
  }),
});

export const auctionConfigSchema = z.object({
  durationHours: z.number().positive().max(72),
  /** Веса тиров номера для ежедневного лота. */
  tierWeights: z
    .object({ legendary: z.number().int().min(0), mythic: z.number().int().min(0) })
    .refine((w) => w.legendary + w.mythic > 0, 'Хотя бы один тир лота должен иметь ненулевой вес'),
  /** Стартовая цена = ценность номера × этот множитель. */
  startPriceFactor: z.number().min(0).max(100),
  minIncrementPercent: z.number().min(0).max(100),
  minIncrementChips: z.number().int().min(1),
  /** Ставка в последние N секунд продлевает аукцион… */
  antiSnipeSeconds: z.number().int().min(0),
  /** …так, чтобы до конца оставалось не меньше N секунд… */
  extendSeconds: z.number().int().min(0),
  /** …но не дальше этого числа минут после исходного окончания. */
  maxExtensionMinutes: z.number().int().min(0),
});

export const exhibitionConfigSchema = z.object({
  minAccountAgeDays: z.number().min(0),
  /** Минимальный прогресс для голосования — всего выбиваний. */
  minRollsTotal: z.number().int().min(0),
  voteRewardChips: z.number().int().min(0),
  maxRewardedVotesPerDay: z.number().int().min(0),
  /** Сколько показов нужно машине, чтобы попасть в итоговый рейтинг. */
  minShows: z.number().int().min(1),
  /** Призы по местам (индекс 0 — первое место). */
  prizes: z.array(z.object({ chips: z.number().int().min(0), rolls: z.number().int().min(0) })).max(100),
});

export const clubsConfigSchema = z.object({
  maxMembers: z.number().int().min(2).max(1000),
  createCostChips: z.number().int().min(0),
  nameMinLength: z.number().int().min(1),
  nameMaxLength: z.number().int().min(1),
});

export const dreamSearchConfigSchema = z.object({
  maxMasks: z.number().int().min(0),
  /** Сколько позиций маски должны быть заданы (не `*`) — защита от масок «на всё подряд». */
  minFixedChars: z.number().int().min(0).max(9),
});

export type CarsConfig = z.infer<typeof carsConfigSchema>;
export type CombosConfig = CarsConfig['combos'];
export type TuningConfig = CarsConfig['tuning'];
export type TripsConfig = CarsConfig['trips'];
export type TripEventConfig = TripsConfig['events'][number];
export type GarageConfig = CarsConfig['garage'];
export type RacesConfig = z.infer<typeof racesConfigSchema>;
export type AuctionConfig = z.infer<typeof auctionConfigSchema>;
export type ExhibitionConfig = z.infer<typeof exhibitionConfigSchema>;
export type ClubsConfig = z.infer<typeof clubsConfigSchema>;
export type DreamSearchConfig = z.infer<typeof dreamSearchConfigSchema>;

export const DEFAULT_CARS_CONFIG: CarsConfig = {
  garage: {
    baseSlots: 3,
    maxSlots: 20,
    slotPriceChips: 2_000,
    slotPriceGrowth: 1.5,
    slotPriceStars: 100,
  },
  plateMount: { removeFeeChips: 50, cooldownHours: 12 },
  sellBackPercent: 60,
  combos: {
    status: {
      income: 1.5,
      prestige: 1.3,
      tierByClass: {
        economy: 'common',
        comfort: 'uncommon',
        business: 'rare',
        premium: 'epic',
        luxury: 'legendary',
        collectible: 'mythic',
      },
    },
    style: { income: 1.25, prestige: 1.2 },
    series: { income: 1.2, prestige: 1.1, minCars: 3 },
    // Шуточное комбо: даёт ачивку и бейдж, но не доход.
    mesalliance: { income: 1, prestige: 1, carClass: 'economy', tier: 'mythic' },
  },
  tuning: {
    palette: [
      '#F4F4F2', '#1C1C1E', '#8E9196', '#C7CACF', '#B3261E', '#1F4FA3',
      '#2E6B3F', '#E8C547', '#E07B24', '#5B2C83', '#6E4B3A', '#3FA7C9',
    ],
    paintChips: { gloss: 0, metallic: 300, pearl: 1_500, matte: 1_200, chameleon: 5_000, exclusive: 0 },
    paintStars: { gloss: 0, metallic: 0, pearl: 0, matte: 0, chameleon: 75, exclusive: 0 },
    paintPrestige: { gloss: 0, metallic: 1, pearl: 3, matte: 3, chameleon: 6, exclusive: 8 },
    exclusivePaints: [
      { id: 'tournament_gold', colors: ['#D4AF37', '#8A6D1E'], title: { ru: 'Чемпионское золото', en: 'Champion gold' } },
      { id: 'tournament_silver', colors: ['#C0C4CA', '#6C7178'], title: { ru: 'Серебро трассы', en: 'Track silver' } },
      { id: 'tournament_bronze', colors: ['#B87333', '#6B3E1A'], title: { ru: 'Бронза заезда', en: 'Race bronze' } },
    ],
    wheels: { variants: 6, costChips: 400, prestige: 2 },
    bodykit: { variants: 4, costChips: 1_500, prestige: 4 },
    tint: { maxLevel: 3, costPerLevel: 150 },
    underglow: { colors: ['#3D8BFF', '#3DDC84', '#FF3D5A', '#B05CFF', '#FFFFFF'], costChips: 800, prestige: 2 },
    engine: { maxLevel: 5, baseCost: 500, costGrowth: 1.8, speedPerLevel: 3, accelerationPerLevel: 4 },
    suspension: { maxLevel: 5, baseCost: 400, costGrowth: 1.7, handlingPerLevel: 4 },
    classCostMultiplier: { economy: 1, comfort: 1.5, business: 2.5, premium: 4, luxury: 6, collectible: 8 },
  },
  trips: {
    durations: [
      { hours: 1, efficiency: 1 },
      { hours: 4, efficiency: 0.9 },
      { hours: 8, efficiency: 0.8 },
    ],
    // Эконом-машина со «Статусом» при поездках круглые сутки окупается за ~8.7 суток, Люкс — за ~5 недель.
    chipsPerPrestigeHour: 0.4,
    tierIncome: { common: 1, uncommon: 1.2, rare: 1.5, epic: 2, legendary: 3, mythic: 5 },
    noEventWeight: 60,
    events: [
      {
        id: 'bloggers',
        weight: 10,
        incomeMultiplier: 1.5,
        title: { ru: 'Тебя сфотографировали блогеры', en: 'Bloggers took photos of your car' },
      },
      {
        id: 'traffic_jam',
        weight: 20,
        incomeMultiplier: 0.7,
        title: { ru: 'Попал в пробку', en: 'Stuck in traffic' },
      },
      {
        id: 'speed_camera',
        weight: 10,
        incomeMultiplier: 0.85,
        condition: 'no_tint',
        title: { ru: 'Камера на перекрёстке: штраф', en: 'Caught by a traffic camera: fine' },
      },
      {
        id: 'night_cruise',
        weight: 5,
        incomeMultiplier: 1.3,
        condition: 'underglow',
        title: { ru: 'Подсветку заметили на ночной покатушке', en: 'Your underglow stole the night cruise' },
      },
    ],
  },
  showroom: { rotatingSlots: 4 },
};

export const DEFAULT_RACES_CONFIG: RacesConfig = {
  dailyLimit: 10,
  weights: { speed: 0.35, acceleration: 0.45, handling: 0.2 },
  randomness: 0.08,
  baseTimeMs: 10_000,
  minBet: 10,
  maxBet: 5_000,
  betFeePercent: 5,
  matchmaking: { baseGap: 8, gapPer15s: 4, maxGap: 40, ghostAfterSeconds: 30, queueTtlSeconds: 600 },
  tournament: {
    prizes: [
      { chips: 5_000, rolls: 10, paint: 'tournament_gold' },
      { chips: 3_000, rolls: 5, paint: 'tournament_silver' },
      { chips: 1_500, rolls: 3, paint: 'tournament_bronze' },
    ],
  },
};

export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  durationHours: 22,
  tierWeights: { legendary: 4, mythic: 1 },
  startPriceFactor: 0.5,
  minIncrementPercent: 5,
  minIncrementChips: 50,
  antiSnipeSeconds: 60,
  extendSeconds: 60,
  maxExtensionMinutes: 30,
};

export const DEFAULT_EXHIBITION_CONFIG: ExhibitionConfig = {
  minAccountAgeDays: 3,
  minRollsTotal: 10,
  voteRewardChips: 2,
  maxRewardedVotesPerDay: 25,
  minShows: 20,
  prizes: [
    { chips: 5_000, rolls: 10 },
    { chips: 3_000, rolls: 7 },
    { chips: 2_000, rolls: 5 },
    { chips: 1_000, rolls: 3 },
    { chips: 800, rolls: 2 },
    { chips: 600, rolls: 2 },
    { chips: 500, rolls: 1 },
    { chips: 400, rolls: 1 },
    { chips: 300, rolls: 1 },
    { chips: 200, rolls: 1 },
  ],
};

export const DEFAULT_CLUBS_CONFIG: ClubsConfig = {
  maxMembers: 30,
  createCostChips: 5_000,
  nameMinLength: 3,
  nameMaxLength: 24,
};

export const DEFAULT_DREAM_SEARCH_CONFIG: DreamSearchConfig = {
  maxMasks: 5,
  minFixedChars: 2,
};
