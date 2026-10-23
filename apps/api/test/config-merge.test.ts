import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, gameConfigSchema } from '@nomer/shared';
import { mergeConfigPatch } from '../src/services/admin';
import { withDefaults } from '../src/services/config';
import { parseReferral } from '../src/services/users';

describe('mergeConfigPatch', () => {
  it('меняет один вес шансов, не трогая остальные', () => {
    const merged = gameConfigSchema.parse(mergeConfigPatch(DEFAULT_GAME_CONFIG, { odds: { mythic: 1000 } }));
    expect(merged.odds.mythic).toBe(1000);
    expect(merged.odds.common).toBe(DEFAULT_GAME_CONFIG.odds.common);
  });

  it('заменяет массив VIP-серий целиком', () => {
    const merged = gameConfigSchema.parse(
      mergeConfigPatch(DEFAULT_GAME_CONFIG, { rarity: { vipSeries: [{ letters: 'ХХХ' }] } }),
    );
    expect(merged.rarity.vipSeries).toEqual([{ letters: 'ХХХ' }]);
    expect(merged.rarity.capitalRegions).toEqual(DEFAULT_GAME_CONFIG.rarity.capitalRegions);
  });

  it('заменяет список регионов', () => {
    const merged = gameConfigSchema.parse(mergeConfigPatch(DEFAULT_GAME_CONFIG, { regions: ['77', '50'] }));
    expect(merged.regions).toEqual(['77', '50']);
  });

  it('некорректная правка не проходит валидацию', () => {
    const bad = mergeConfigPatch(DEFAULT_GAME_CONFIG, { regions: ['7'] });
    expect(gameConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe('withDefaults', () => {
  it('дополняет старый конфиг новыми секциями и полями', () => {
    const { quests, ...old } = DEFAULT_GAME_CONFIG;
    const { dayOffsetHours, ...oldEconomy } = old.economy;
    const restored = gameConfigSchema.parse(withDefaults({ ...old, economy: oldEconomy }));
    expect(restored.quests).toEqual(quests);
    expect(restored.economy.dayOffsetHours).toBe(dayOffsetHours);
  });
});

describe('parseReferral', () => {
  it('разбирает ref_<telegramId>', () => {
    expect(parseReferral('ref_123456789')).toBe(123456789n);
    expect(parseReferral('trade_abc')).toBeNull();
    expect(parseReferral('ref_')).toBeNull();
    expect(parseReferral(null)).toBeNull();
  });
});
