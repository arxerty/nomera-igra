import { describe, expect, it } from 'vitest';
import { maskToSqlLike, matchesMask, parseMask, parsePlate } from '../src';

const matches = (mask: string, plate: string) => matchesMask(parsePlate(plate)!, parseMask(mask)!);

describe('parseMask', () => {
  it('разбирает маску с регионом', () => {
    expect(parseMask('*777** 77')).toEqual({
      body: [null, '7', '7', '7', null, null],
      region: ['7', '7'],
    });
  });

  it('приводит латиницу к кириллице', () => {
    expect(parseMask('a***aa')!.body).toEqual(['А', null, null, null, 'А', 'А']);
  });

  it('отклоняет кривые маски', () => {
    expect(parseMask('*777*')).toBeNull();
    expect(parseMask('7777**')).toBeNull(); // цифра на месте буквы
    expect(parseMask('*7А7**')).toBeNull(); // буква на месте цифры
    expect(parseMask('*777** 7')).toBeNull();
    expect(parseMask('*777** 77 1')).toBeNull();
    expect(parseMask('')).toBeNull();
  });
});

describe('matchesMask', () => {
  it('ищет по цифрам', () => {
    expect(matches('*777**', 'А777ВС 50')).toBe(true);
    expect(matches('*777**', 'А778ВС 50')).toBe(false);
  });

  it('учитывает регион, если он задан', () => {
    expect(matches('*777** 77', 'А777ВС 77')).toBe(true);
    expect(matches('*777** 77', 'А777ВС 177')).toBe(false);
    expect(matches('*777** 1**', 'А777ВС 177')).toBe(true);
    expect(matches('?777??', 'А777ВС 177')).toBe(true);
  });

  it('ищет по буквам', () => {
    expect(matches('А***АА', 'А123АА 50')).toBe(true);
    expect(matches('А***АА', 'А123АВ 50')).toBe(false);
  });
});

describe('maskToSqlLike', () => {
  it('заменяет подстановки на _', () => {
    expect(maskToSqlLike(parseMask('*777** 7*')!)).toEqual({ body: '_777__', region: '7_' });
    expect(maskToSqlLike(parseMask('А***АА')!)).toEqual({ body: 'А___АА', region: null });
  });
});
