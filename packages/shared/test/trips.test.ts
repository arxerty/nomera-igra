import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAR_MODELS,
  DEFAULT_GAME_CONFIG,
  createSeededRng,
  rollTripEvent,
  settleTrip,
  tripBaseIncome,
  tripEndsAt,
  tripHourlyIncome,
} from '../src';

const { cars } = DEFAULT_GAME_CONFIG;
const trips = cars.trips;

describe('доход покатушек', () => {
  it('зависит от престижа, редкости номера и комбо', () => {
    const base = tripHourlyIncome({ prestige: 50, tier: 'common', incomeMultiplier: 1 }, trips);
    expect(base).toBeCloseTo(50 * trips.chipsPerPrestigeHour, 9);
    expect(tripHourlyIncome({ prestige: 50, tier: 'legendary', incomeMultiplier: 1 }, trips)).toBeCloseTo(
      base * trips.tierIncome.legendary,
      9,
    );
    expect(tripHourlyIncome({ prestige: 50, tier: 'common', incomeMultiplier: 1.5 }, trips)).toBeCloseTo(base * 1.5, 9);
  });

  it('длинная поездка выгоднее по сумме, но не по часу', () => {
    const one = tripBaseIncome(10, 1, trips)!;
    const eight = tripBaseIncome(10, 8, trips)!;
    expect(eight).toBeGreaterThan(one);
    expect(eight / 8).toBeLessThan(one);
  });

  it('неизвестная длительность — null', () => {
    expect(tripBaseIncome(10, 3, trips)).toBeNull();
  });

  it('время возвращения', () => {
    expect(tripEndsAt(new Date('2026-10-22T10:00:00Z'), 4).toISOString()).toBe('2026-10-22T14:00:00.000Z');
  });

  it('машина не окупается покатушками быстрее недели даже со «Статусом» и поездками круглые сутки', () => {
    const tierFor = cars.combos.status.tierByClass;
    const best = trips.durations.reduce((a, d) => (d.hours * d.efficiency > a.hours * a.efficiency ? d : a));
    const tripsPerDay = Math.floor(24 / best.hours);
    for (const m of DEFAULT_CAR_MODELS) {
      const hourly = tripHourlyIncome(
        { prestige: m.stats.prestige, tier: tierFor[m.class], incomeMultiplier: cars.combos.status.income },
        trips,
      );
      const perDay = tripBaseIncome(hourly, best.hours, trips)! * tripsPerDay;
      expect(m.priceChips / perDay, m.id).toBeGreaterThan(7);
    }
  });
});

describe('события поездки', () => {
  const plain = { tint: 0, underglow: null };
  const tinted = { tint: 2, underglow: '#3D8BFF' };

  it('частоты соответствуют весам', () => {
    const rng = createSeededRng(1);
    const counts = new Map<string, number>();
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const e = rollTripEvent(rng, tinted, trips);
      const key = e?.id ?? 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = trips.noEventWeight + trips.events.reduce((s, e) => s + e.weight, 0);
    // Тонированная машина камеру не ловит — её доля уходит в «без происшествий».
    const camera = trips.events.find((e) => e.id === 'speed_camera')!;
    expect(counts.get('speed_camera')).toBeUndefined();
    expect((counts.get('none') ?? 0) / n).toBeCloseTo((trips.noEventWeight + camera.weight) / total, 2);
    for (const e of trips.events.filter((x) => x.id !== 'speed_camera')) {
      expect((counts.get(e.id) ?? 0) / n, e.id).toBeCloseTo(e.weight / total, 2);
    }
  });

  it('без тонировки камера ловит, без подсветки ночной покатушки нет', () => {
    const rng = createSeededRng(2);
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) seen.add(rollTripEvent(rng, plain, trips)?.id ?? 'none');
    expect(seen).toContain('speed_camera');
    expect(seen).not.toContain('night_cruise');
  });

  it('итог поездки с событием', () => {
    expect(settleTrip(100, null)).toEqual({ base: 100, eventId: null, eventDelta: 0, total: 100 });
    expect(settleTrip(100, { id: 'bloggers', incomeMultiplier: 1.5 })).toEqual({
      base: 100,
      eventId: 'bloggers',
      eventDelta: 50,
      total: 150,
    });
    expect(settleTrip(100, { id: 'speed_camera', incomeMultiplier: 0.85 }).eventDelta).toBe(-15);
  });
});
