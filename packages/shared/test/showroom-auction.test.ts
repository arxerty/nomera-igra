import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAR_MODELS,
  DEFAULT_GAME_CONFIG,
  auctionStartPrice,
  createSeededRng,
  editionLeft,
  endsAtAfterBid,
  minNextBid,
  rollAuctionTier,
  showroomForDay,
  validateBid,
} from '../src';

const slots = DEFAULT_GAME_CONFIG.cars.showroom.rotatingSlots;
const ids = (day: string, sold?: Map<string, number>) =>
  showroomForDay(DEFAULT_CAR_MODELS, day, slots, sold).map((m) => m.id);

describe('салон', () => {
  it('в течение суток ассортимент одинаковый', () => {
    expect(ids('2026-10-22')).toEqual(ids('2026-10-22'));
  });

  it('постоянные модели всегда, из ротации — ровно rotatingSlots', () => {
    const today = new Set(ids('2026-10-22'));
    for (const m of DEFAULT_CAR_MODELS.filter((x) => x.showroom === 'always')) expect(today).toContain(m.id);
    const rotating = DEFAULT_CAR_MODELS.filter((x) => x.showroom === 'rotating' && today.has(x.id));
    expect(rotating).toHaveLength(slots);
  });

  it('ротация меняется по дням', () => {
    const variants = new Set<string>();
    for (let d = 1; d <= 20; d++) variants.add(ids(`2026-11-${String(d).padStart(2, '0')}`).join(','));
    expect(variants.size).toBeGreaterThan(5);
  });

  it('сезонная модель продаётся только в свой сезон', () => {
    const base = DEFAULT_CAR_MODELS.find((m) => m.showroom === 'always')!;
    const seasonal = { ...base, id: 'winter_special', season: '2026-12' };
    const models = [...DEFAULT_CAR_MODELS, seasonal];
    const at = (day: string) => showroomForDay(models, day, slots).map((m) => m.id);
    expect(at('2026-12-05')).toContain('winter_special');
    expect(at('2026-11-30')).not.toContain('winter_special');
    expect(at('2027-01-01')).not.toContain('winter_special');
  });

  it('распроданная коллекционная модель исчезает', () => {
    const limited = DEFAULT_CAR_MODELS.find((m) => m.showroom === 'limited')!;
    expect(ids('2026-10-22')).toContain(limited.id);
    expect(ids('2026-10-22', new Map([[limited.id, limited.editionSize!]]))).not.toContain(limited.id);
    expect(editionLeft(limited, 7)).toBe(limited.editionSize! - 7);
    expect(editionLeft({}, 7)).toBeNull();
  });
});

describe('аукцион', () => {
  const cfg = DEFAULT_GAME_CONFIG.auction;
  const end = new Date('2026-10-22T20:00:00Z');

  it('тир лота — легендарный или мифический по весам', () => {
    const rng = createSeededRng(11);
    let mythic = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (rollAuctionTier(rng, cfg) === 'mythic') mythic++;
    const { legendary, mythic: w } = cfg.tierWeights;
    expect(mythic / n).toBeCloseTo(w / (legendary + w), 2);
  });

  it('стартовая цена и шаг ставки', () => {
    expect(auctionStartPrice(25_000, cfg)).toBe(12_500);
    expect(minNextBid(null, 12_500, cfg)).toBe(12_500);
    expect(minNextBid(12_500, 12_500, cfg)).toBe(12_500 + Math.ceil(12_500 * 0.05));
    // На маленьких суммах работает минимальный шаг в Фишках.
    expect(minNextBid(100, 100, cfg)).toBe(100 + cfg.minIncrementChips);
  });

  it('проверка ставки', () => {
    const state = { currentBid: 1000, leaderId: 'u1', startPrice: 500, endsAt: end };
    const at = new Date('2026-10-22T19:00:00Z');
    expect(validateBid({ amount: 1050, bidderId: 'u2', at }, state, cfg)).toBeNull();
    expect(validateBid({ amount: 1049, bidderId: 'u2', at }, state, cfg)).toBe('bid_too_low');
    expect(validateBid({ amount: 5000, bidderId: 'u1', at }, state, cfg)).toBe('already_leading');
    expect(validateBid({ amount: 5000, bidderId: 'u2', at: end }, state, cfg)).toBe('auction_ended');
  });

  it('антиснайпинг: ставка в последнюю минуту продлевает таймер', () => {
    const early = new Date(end.getTime() - 5 * 60_000);
    expect(endsAtAfterBid(end, end, early, cfg)).toEqual(end);
    const late = new Date(end.getTime() - 10_000);
    expect(endsAtAfterBid(end, end, late, cfg).getTime()).toBe(late.getTime() + cfg.extendSeconds * 1000);
  });

  it('продления упираются в предел', () => {
    const limit = end.getTime() + cfg.maxExtensionMinutes * 60_000;
    const current = new Date(limit - 5_000);
    const bidAt = new Date(limit - 10_000);
    expect(endsAtAfterBid(current, end, bidAt, cfg).getTime()).toBe(limit);
  });
});
