import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  TIERS,
  classifyPlate,
  marketSettlement,
  oddsAsPercent,
  parsePlate,
  plateValue,
  dailyStreakReward,
  gameConfigSchema,
} from '../src';

const { prices, rarity } = DEFAULT_GAME_CONFIG;
const valueOf = (s: string) => plateValue(classifyPlate(parsePlate(s)!, rarity), prices);

describe('plateValue', () => {
  it('базовая цена по тиру', () => {
    expect(valueOf('А245ВС 50')).toBe(prices.base.common);
    expect(valueOf('А555ВС 50')).toBe(prices.base.rare);
    expect(valueOf('А001АА 77')).toBe(prices.base.mythic);
  });

  it('множитель за совпадение с регионом', () => {
    expect(valueOf('А245ВС 245')).toBe(Math.round(prices.base.common * 1.5));
  });

  it('множители бонусов перемножаются', () => {
    // 777 — столичный регион Москвы: мифик с обоими бонусами
    expect(valueOf('А777АА 777')).toBe(Math.round(prices.base.mythic * 1.5 * 1.3));
  });

  it('цена не убывает с тиром', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(prices.base[TIERS[i]!]).toBeGreaterThan(prices.base[TIERS[i - 1]!]);
    }
  });
});

describe('marketSettlement', () => {
  it('удерживает комиссию с продавца, округляя вниз', () => {
    expect(marketSettlement(1000, 5)).toEqual({ price: 1000, fee: 50, sellerReceives: 950 });
    expect(marketSettlement(19, 5)).toEqual({ price: 19, fee: 0, sellerReceives: 19 });
    expect(marketSettlement(1000, 0)).toEqual({ price: 1000, fee: 0, sellerReceives: 1000 });
  });
});

describe('конфиг', () => {
  it('дефолтный конфиг проходит валидацию', () => {
    expect(gameConfigSchema.safeParse(DEFAULT_GAME_CONFIG).success).toBe(true);
  });

  it('шансы по умолчанию дают в сумме 100%', () => {
    const pct = oddsAsPercent(DEFAULT_GAME_CONFIG.odds);
    const total = Object.values(pct).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 9);
    expect(pct.mythic).toBeCloseTo(0.05, 9);
  });

  it('отклоняет нулевые шансы и кривые VIP-серии', () => {
    const zeroOdds = Object.fromEntries(TIERS.map((t) => [t, 0]));
    expect(gameConfigSchema.safeParse({ ...DEFAULT_GAME_CONFIG, odds: zeroOdds }).success).toBe(false);
    const badVip = { ...DEFAULT_GAME_CONFIG.rarity, vipSeries: [{ letters: 'ЯЯЯ' }] };
    expect(gameConfigSchema.safeParse({ ...DEFAULT_GAME_CONFIG, rarity: badVip }).success).toBe(false);
  });

  it('попытка за Фишки стоит дороже матожидания продажи', () => {
    const pct = oddsAsPercent(DEFAULT_GAME_CONFIG.odds);
    const ev = TIERS.reduce((s, t) => s + (pct[t] / 100) * prices.base[t], 0);
    expect(DEFAULT_GAME_CONFIG.economy.rollCostChips).toBeGreaterThan(ev);
  });

  it('награда за серию держится на последнем дне', () => {
    const { economy } = DEFAULT_GAME_CONFIG;
    expect(dailyStreakReward(economy, 1)).toEqual(economy.dailyStreak[0]);
    expect(dailyStreakReward(economy, 100)).toEqual(economy.dailyStreak.at(-1));
  });
});
