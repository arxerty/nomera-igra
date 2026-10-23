import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAR_MODELS,
  DEFAULT_GAME_CONFIG,
  carCombos,
  carSellBackPrice,
  carValue,
  classifyPlate,
  comboMultipliers,
  evaluateCar,
  garageSlotPrice,
  largestSeries,
  parsePlate,
  plateChangeAvailableAt,
  plateValue,
  stockTuning,
  type CarModel,
  type GarageCar,
} from '../src';

const { cars, rarity, prices } = DEFAULT_GAME_CONFIG;
const combos = cars.combos;

const model = (id: string): CarModel => DEFAULT_CAR_MODELS.find((m) => m.id === id)!;

let seq = 0;
function car(modelId: string, plate: string | null): GarageCar {
  const p = plate ? parsePlate(plate)! : null;
  const r = p ? classifyPlate(p, rarity) : null;
  return {
    id: `car${++seq}`,
    model: model(modelId),
    tuning: stockTuning('#F4F4F2'),
    plate: p && r ? { plate: p, tier: r.tier, value: plateValue(r, prices) } : null,
  };
}

describe('комбо', () => {
  it('без номера комбо нет', () => {
    const c = car('derzhava_regent', null);
    expect(carCombos(c, [c], combos)).toEqual([]);
  });

  it('«Статус»: легендарный номер на Люкс', () => {
    const c = car('derzhava_regent', 'А777АА 50'); // одинаковые буквы и цифры — легендарка
    expect(c.plate!.tier).toBe('legendary');
    expect(carCombos(c, [c], combos)).toContain('status');
  });

  it('«Статус» не срабатывает, если редкость не та', () => {
    const c = car('derzhava_regent', 'А245ВС 50');
    expect(carCombos(c, [c], combos)).not.toContain('status');
  });

  it('«Стиль»: цифры совпадают с названием модели', () => {
    const c = car('rassvet_412', 'В412КМ 50');
    expect(carCombos(c, [c], combos)).toContain('style');
  });

  it('«Стиль»: цифры совпадают с годом', () => {
    const c = car('rassvet_412', 'В069КМ 50');
    expect(carCombos(c, [c], combos)).toContain('style');
  });

  it('«Своя серия»: от трёх машин с одной буквенной серией — у всех машин серии', () => {
    const a = car('zarya_2101', 'А245КР 50');
    const b = car('ladoga_granit', 'А318КР 77');
    const garage2 = [a, b];
    expect(carCombos(a, garage2, combos)).not.toContain('series');

    const c = car('korsar_sirius', 'А902КР 99');
    const other = car('falke_fuenf', 'К245КР 50'); // другая первая буква — другая серия
    const garage = [a, b, c, other];
    for (const x of [a, b, c]) expect(carCombos(x, garage, combos)).toContain('series');
    expect(carCombos(other, garage, combos)).not.toContain('series');
    expect(largestSeries(garage)).toBe(3);
  });

  it('«Мезальянс»: мифический номер на эконом-классе', () => {
    const c = car('zarya_2101', 'А777АА 77');
    expect(c.plate!.tier).toBe('mythic');
    const list = carCombos(c, [c], combos);
    expect(list).toContain('mesalliance');
    expect(list).not.toContain('status');
  });

  it('множители комбо перемножаются', () => {
    const m = comboMultipliers(['status', 'style'], combos);
    expect(m.income).toBeCloseTo(combos.status.income * combos.style.income, 9);
    expect(m.prestige).toBeCloseTo(combos.status.prestige * combos.style.prestige, 9);
    expect(comboMultipliers([], combos)).toEqual({ income: 1, prestige: 1 });
  });
});

describe('стоимость машины', () => {
  it('цена модели + ценность номера × множитель', () => {
    expect(carValue(1000, 200, 1.3)).toBe(1260);
    expect(carValue(1000, null, 1.3)).toBe(1000);
  });

  it('evaluateCar учитывает комбо в стоимости и престиже', () => {
    const c = car('derzhava_regent', 'А777АА 50');
    const e = evaluateCar(c, [c], cars);
    expect(e.combos).toEqual(['status']);
    expect(e.value).toBe(c.model.priceChips + Math.round(c.plate!.value * combos.status.prestige));
    expect(e.stats.prestige).toBe(c.model.stats.prestige);
    expect(e.prestige).toBe(Math.round(c.model.stats.prestige * combos.status.prestige));
  });
});

describe('гараж и перевес номера', () => {
  const g = cars.garage;

  it('место в гараже дорожает и упирается в максимум', () => {
    expect(garageSlotPrice(g.baseSlots, g)!.chips).toBe(g.slotPriceChips);
    expect(garageSlotPrice(g.baseSlots + 1, g)!.chips).toBe(Math.round(g.slotPriceChips * g.slotPriceGrowth));
    expect(garageSlotPrice(g.maxSlots, g)).toBeNull();
  });

  it('кулдаун смены номера', () => {
    const at = new Date('2026-10-22T10:00:00Z');
    expect(plateChangeAvailableAt(null, at, cars)).toBeNull();
    const until = plateChangeAvailableAt(at, new Date('2026-10-22T11:00:00Z'), cars);
    expect(until!.toISOString()).toBe('2026-10-22T22:00:00.000Z');
    expect(plateChangeAvailableAt(at, new Date('2026-10-22T22:00:00Z'), cars)).toBeNull();
  });

  it('система выкупает машину дешевле цены салона', () => {
    const m = model('falke_fuenf');
    expect(carSellBackPrice(m, cars)).toBe(Math.floor(m.priceChips * 0.6));
  });
});
