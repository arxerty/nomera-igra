import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAR_MODELS,
  DEFAULT_GAME_CONFIG,
  MAX_STAT,
  effectiveStats,
  paintPrice,
  stockTuning,
  tuningCost,
  upgradeLevelCost,
  validateTuning,
  type CarTuning,
} from '../src';

const cfg = DEFAULT_GAME_CONFIG.cars.tuning;
const stock = stockTuning(cfg.palette[0]!);
const sirius = DEFAULT_CAR_MODELS.find((m) => m.id === 'korsar_sirius')!;
const prototype = DEFAULT_CAR_MODELS.find((m) => m.id === 'sokol_prototype_1')!;

describe('validateTuning', () => {
  it('заводской тюнинг валиден', () => {
    expect(validateTuning(stock, cfg)).toBeNull();
  });

  it('ловит цвета не из палитры и уровни за пределами', () => {
    expect(validateTuning({ ...stock, paint: { finish: 'gloss', color: '#123456' } }, cfg)).toBe('unknown_color');
    expect(validateTuning({ ...stock, paint: { finish: 'exclusive', color: 'nope' } }, cfg)).toBe('unknown_exclusive_paint');
    expect(validateTuning({ ...stock, engine: cfg.engine.maxLevel + 1 }, cfg)).toBe('engine_out_of_range');
    expect(validateTuning({ ...stock, tint: -1 }, cfg)).toBe('tint_out_of_range');
    expect(validateTuning({ ...stock, underglow: '#000000' }, cfg)).toBe('unknown_underglow');
  });

  it('эксклюзивная окраска по id', () => {
    expect(validateTuning({ ...stock, paint: { finish: 'exclusive', color: 'tournament_gold' } }, cfg)).toBeNull();
  });
});

describe('effectiveStats', () => {
  it('двигатель и подвеска поднимают ходовые, косметика — престиж', () => {
    const t: CarTuning = {
      ...stock,
      paint: { finish: 'pearl', color: cfg.palette[1]! },
      wheels: 1,
      bodykit: 2,
      underglow: cfg.underglow.colors[0]!,
      engine: 2,
      suspension: 1,
    };
    const s = effectiveStats(sirius, t, cfg);
    expect(s.speed).toBe(sirius.stats.speed + 2 * cfg.engine.speedPerLevel);
    expect(s.acceleration).toBe(sirius.stats.acceleration + 2 * cfg.engine.accelerationPerLevel);
    expect(s.handling).toBe(sirius.stats.handling + cfg.suspension.handlingPerLevel);
    expect(s.prestige).toBe(
      sirius.stats.prestige + cfg.paintPrestige.pearl + cfg.wheels.prestige + cfg.bodykit.prestige + cfg.underglow.prestige,
    );
  });

  it('характеристики не выходят за потолок', () => {
    const s = effectiveStats(prototype, { ...stock, engine: cfg.engine.maxLevel, suspension: cfg.suspension.maxLevel }, cfg);
    for (const v of Object.values(s)) expect(v).toBeLessThanOrEqual(MAX_STAT);
  });
});

describe('tuningCost', () => {
  it('ничего не меняем — бесплатно', () => {
    expect(tuningCost('economy', stock, stock, cfg)).toEqual({ ok: true, chips: 0 });
  });

  it('уровни двигателя суммируются и дорожают с классом', () => {
    const to = { ...stock, engine: 2 };
    const eco = tuningCost('economy', stock, to, cfg);
    const lux = tuningCost('luxury', stock, to, cfg);
    const expected = upgradeLevelCost('engine', 1, 'economy', cfg) + upgradeLevelCost('engine', 2, 'economy', cfg);
    expect(eco).toEqual({ ok: true, chips: expected });
    expect(lux.ok && eco.ok && lux.chips > eco.chips).toBe(true);
  });

  it('платим только за изменённое; снять подсветку и тонировку — бесплатно', () => {
    const tuned: CarTuning = { ...stock, tint: 2, underglow: cfg.underglow.colors[0]! };
    expect(tuningCost('economy', stock, tuned, cfg)).toEqual({
      ok: true,
      chips: 2 * cfg.tint.costPerLevel + cfg.underglow.costChips,
    });
    expect(tuningCost('economy', tuned, stock, cfg)).toEqual({ ok: true, chips: 0 });
  });

  it('перекраска стоит по цене новой отделки', () => {
    const chameleon = { ...stock, paint: { finish: 'chameleon' as const, color: cfg.palette[3]! } };
    expect(tuningCost('comfort', stock, chameleon, cfg)).toEqual({ ok: true, chips: cfg.paintChips.chameleon });
  });

  it('двигатель нельзя откатить', () => {
    expect(tuningCost('economy', { ...stock, engine: 3 }, { ...stock, engine: 1 }, cfg)).toEqual({
      ok: false,
      error: 'downgrade',
    });
  });

  it('хамелеон можно купить и за Stars, глянец — нет', () => {
    expect(paintPrice('chameleon', cfg).stars).toBe(cfg.paintStars.chameleon);
    expect(paintPrice('gloss', cfg)).toEqual({ chips: 0, stars: null });
  });
});
