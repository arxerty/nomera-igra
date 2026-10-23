import { z } from 'zod';
import {
  DEFAULT_AUCTION_CONFIG,
  DEFAULT_CARS_CONFIG,
  DEFAULT_CLUBS_CONFIG,
  DEFAULT_DREAM_SEARCH_CONFIG,
  DEFAULT_EXHIBITION_CONFIG,
  DEFAULT_RACES_CONFIG,
  auctionConfigSchema,
  carsConfigSchema,
  clubsConfigSchema,
  dreamSearchConfigSchema,
  exhibitionConfigSchema,
  racesConfigSchema,
} from './car-config';
import { CAR_CLASSES } from './cars';
import { isPlateLetter, isValidRegionCode } from './plate';
import { BONUS_IDS, TIERS, type BonusId, type Tier } from './rarity';
import { DEFAULT_CAPITAL_REGIONS, DEFAULT_REGION_CODES } from './regions';

const regionCode = z.string().refine(isValidRegionCode, 'Код региона: 2–3 цифры');

const tierRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(TIERS.map((t) => [t, value])) as Record<Tier, T>);

const bonusRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(BONUS_IDS.map((b) => [b, value])) as Record<BonusId, T>);

export const QUEST_EVENTS = [
  'roll',
  'sell_system',
  'market_list',
  'market_buy',
  'market_sell',
  'trade',
  'car_buy',
  'plate_mount',
  'trip_start',
  'race_win',
  'race_loss',
  'series_size',
  'exhibition_vote',
] as const;
export type QuestEvent = (typeof QUEST_EVENTS)[number];

/**
 * Как считается прогресс задания:
 * count — каждое событие добавляет count (по умолчанию);
 * streak — как count, но событие-«срыв» (STREAK_BREAKERS) обнуляет прогресс;
 * max — прогресс равен наибольшему сообщённому значению (например, размеру серии).
 */
export const QUEST_MODES = ['count', 'streak', 'max'] as const;
export type QuestMode = (typeof QUEST_MODES)[number];

/** Для заданий «подряд»: какое событие сбрасывает серию. */
export const STREAK_BREAKERS: Partial<Record<QuestEvent, QuestEvent>> = { race_win: 'race_loss' };

export const vipSeriesSchema = z.object({
  letters: z
    .string()
    .length(3)
    .refine((s) => [...s].every(isPlateLetter), 'Только буквы А В Е К М Н О Р С Т У Х'),
  regions: z.array(regionCode).optional(),
});

export const gameConfigSchema = z.object({
  /**
   * Веса выпадения тиров (целые числа). Шанс тира = вес / сумма весов.
   * По умолчанию заданы в долях на миллион (ppm).
   */
  odds: tierRecord(z.number().int().min(0)).refine(
    (o) => Object.values(o).some((w) => w > 0),
    'Хотя бы один тир должен иметь ненулевой шанс',
  ),
  rarity: z.object({
    vipSeries: z.array(vipSeriesSchema),
    capitalRegions: z.array(regionCode),
    mythicNumbers: z.array(z.number().int().min(1).max(999)).min(1),
  }),
  /** Регионы, которые могут выпасть при выбивании. */
  regions: z.array(regionCode).min(1),
  prices: z.object({
    /** Цена продажи системе в Фишках по тиру. */
    base: tierRecord(z.number().int().min(0)),
    /** Множители цены за бонусы; перемножаются. */
    bonusMultipliers: bonusRecord(z.number().min(1).max(100)),
  }),
  economy: z.object({
    startingChips: z.number().int().min(0),
    startingRolls: z.number().int().min(0),
    freeRollIntervalHours: z.number().positive().max(168),
    rollCostChips: z.number().int().min(1),
    /** Комиссия рынка в процентах от цены лота, удерживается с продавца. */
    marketFeePercent: z.number().min(0).max(50),
    minListingPrice: z.number().int().min(1),
    maxListingPrice: z.number().int().min(1),
    /** Награды за серию входов: индекс 0 — первый день; дальше последнего дня держится последняя награда. */
    dailyStreak: z
      .array(z.object({ rolls: z.number().int().min(0), chips: z.number().int().min(0) }))
      .min(1),
    referralRewardChips: z.number().int().min(0),
    /** Смещение игровых суток от UTC в часах (3 — сутки по Москве). */
    dayOffsetHours: z.number().int().min(-12).max(14),
    tradeOfferTtlHours: z.number().positive().max(720),
  }),
  /** Ежедневные задания: прогресс сбрасывается с началом игровых суток. */
  quests: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9_]+$/),
      event: z.enum(QUEST_EVENTS),
      /** Засчитываются только номера не ниже этого тира. */
      minTier: z.enum(TIERS).optional(),
      /** Засчитываются только машины не ниже этого класса. */
      minCarClass: z.enum(CAR_CLASSES).optional(),
      /** По умолчанию count. */
      mode: z.enum(QUEST_MODES).optional(),
      target: z.number().int().min(1),
      rewardChips: z.number().int().min(0),
      rewardRolls: z.number().int().min(0),
      title: z.object({ ru: z.string().min(1), en: z.string().min(1) }),
    }).refine((q) => q.mode !== 'streak' || STREAK_BREAKERS[q.event] !== undefined, {
      message: 'Режим streak доступен только для событий, у которых есть срыв серии',
    }),
  ).refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'id заданий должны быть уникальны'),
  stars: z.object({
    packs: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]+$/),
          rolls: z.number().int().min(1),
          stars: z.number().int().min(1),
        }),
      )
      .min(1),
  }),
  cars: carsConfigSchema,
  races: racesConfigSchema,
  auction: auctionConfigSchema,
  exhibition: exhibitionConfigSchema,
  clubs: clubsConfigSchema,
  dreamSearch: dreamSearchConfigSchema,
});

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type TierOdds = GameConfig['odds'];
export type PriceConfig = GameConfig['prices'];
export type EconomyConfig = GameConfig['economy'];
export type QuestConfig = GameConfig['quests'][number];

export const DEFAULT_GAME_CONFIG: GameConfig = {
  odds: {
    common: 640_000,
    uncommon: 250_000,
    rare: 85_000,
    epic: 20_000,
    legendary: 4_500,
    mythic: 500,
  },
  rarity: {
    vipSeries: [{ letters: 'ЕКХ' }, { letters: 'АМР' }, { letters: 'ОМР' }, { letters: 'ВОР' }],
    capitalRegions: [...DEFAULT_CAPITAL_REGIONS],
    mythicNumbers: [1, 777],
  },
  regions: [...DEFAULT_REGION_CODES],
  prices: {
    base: {
      common: 10,
      uncommon: 40,
      rare: 150,
      epic: 600,
      legendary: 3_000,
      mythic: 25_000,
    },
    bonusMultipliers: {
      region_match: 1.5,
      palindrome: 1.3,
    },
  },
  economy: {
    startingChips: 300,
    startingRolls: 3,
    freeRollIntervalHours: 4,
    // Матожидание выручки с одного выбивания при дефолтных шансах ≈ 67 Фишек,
    // поэтому покупка попытки за Фишки не окупается продажей системе.
    rollCostChips: 100,
    marketFeePercent: 5,
    minListingPrice: 10,
    maxListingPrice: 10_000_000,
    dailyStreak: [
      { rolls: 1, chips: 20 },
      { rolls: 1, chips: 30 },
      { rolls: 1, chips: 40 },
      { rolls: 2, chips: 50 },
      { rolls: 2, chips: 60 },
      { rolls: 2, chips: 80 },
      { rolls: 3, chips: 150 },
    ],
    referralRewardChips: 200,
    dayOffsetHours: 3,
    tradeOfferTtlHours: 72,
  },
  quests: [
    {
      id: 'roll_3',
      event: 'roll',
      target: 3,
      rewardChips: 30,
      rewardRolls: 0,
      title: { ru: 'Выбей 3 номера', en: 'Roll 3 plates' },
    },
    {
      id: 'roll_rare',
      event: 'roll',
      minTier: 'rare',
      target: 1,
      rewardChips: 0,
      rewardRolls: 1,
      title: { ru: 'Выбей редкий номер или лучше', en: 'Roll a rare plate or better' },
    },
    {
      id: 'sell_system_1',
      event: 'sell_system',
      target: 1,
      rewardChips: 15,
      rewardRolls: 0,
      title: { ru: 'Продай номер системе', en: 'Sell a plate to the system' },
    },
    {
      id: 'market_list_1',
      event: 'market_list',
      target: 1,
      rewardChips: 25,
      rewardRolls: 0,
      title: { ru: 'Выставь номер на рынок', en: 'List a plate on the market' },
    },
    {
      id: 'market_buy_1',
      event: 'market_buy',
      target: 1,
      rewardChips: 0,
      rewardRolls: 1,
      title: { ru: 'Купи номер на рынке', en: 'Buy a plate on the market' },
    },
    {
      id: 'mount_rare_business',
      event: 'plate_mount',
      minTier: 'rare',
      minCarClass: 'business',
      target: 1,
      rewardChips: 60,
      rewardRolls: 0,
      title: {
        ru: 'Повесь номер редкости «Редкий» и выше на машину класса «Бизнес» или выше',
        en: 'Mount a rare or better plate on a business-class or better car',
      },
    },
    {
      id: 'trip_3',
      event: 'trip_start',
      target: 3,
      rewardChips: 40,
      rewardRolls: 0,
      title: { ru: 'Отправь 3 машины на покатушки', en: 'Send 3 cars on a cruise' },
    },
    {
      id: 'race_win_streak_2',
      event: 'race_win',
      mode: 'streak',
      target: 2,
      rewardChips: 0,
      rewardRolls: 1,
      title: { ru: 'Выиграй 2 гонки подряд', en: 'Win 2 races in a row' },
    },
    {
      id: 'series_3',
      event: 'series_size',
      mode: 'max',
      target: 3,
      rewardChips: 100,
      rewardRolls: 0,
      title: {
        ru: 'Собери серию из трёх номеров одной буквенной серии на машинах',
        en: 'Mount three plates of the same letter series on your cars',
      },
    },
  ],
  stars: {
    packs: [
      { id: 'rolls_5', rolls: 5, stars: 25 },
      { id: 'rolls_15', rolls: 15, stars: 65 },
      { id: 'rolls_50', rolls: 50, stars: 190 },
    ],
  },
  cars: DEFAULT_CARS_CONFIG,
  races: DEFAULT_RACES_CONFIG,
  auction: DEFAULT_AUCTION_CONFIG,
  exhibition: DEFAULT_EXHIBITION_CONFIG,
  clubs: DEFAULT_CLUBS_CONFIG,
  dreamSearch: DEFAULT_DREAM_SEARCH_CONFIG,
};

/** Шансы тиров в процентах — для экрана «Шансы». */
export function oddsAsPercent(odds: TierOdds): Record<Tier, number> {
  const total = TIERS.reduce((sum, t) => sum + odds[t], 0);
  return Object.fromEntries(
    TIERS.map((t) => [t, total === 0 ? 0 : (odds[t] / total) * 100]),
  ) as Record<Tier, number>;
}

/** Награда за N-й день серии (1-based). После последнего дня держится максимальная награда. */
export function dailyStreakReward(economy: EconomyConfig, day: number) {
  const list = economy.dailyStreak;
  return list[Math.min(Math.max(day, 1), list.length) - 1]!;
}
