import { describe, expect, it } from 'vitest';
import {
  PLATE_LETTERS,
  REGIONS,
  formatPlate,
  isValidPlate,
  parsePlate,
  plateKey,
  DEFAULT_CAPITAL_REGIONS,
} from '../src';

describe('алфавит', () => {
  it('содержит ровно 12 кириллических букв', () => {
    expect(PLATE_LETTERS).toHaveLength(12);
    for (const l of PLATE_LETTERS) {
      const code = l.codePointAt(0)!;
      expect(code).toBeGreaterThanOrEqual(0x410);
      expect(code).toBeLessThanOrEqual(0x42f);
    }
  });
});

describe('parsePlate', () => {
  it('разбирает стандартный номер', () => {
    expect(parsePlate('А123ВС 77')).toEqual({ letters: 'АВС', number: 123, region: '77' });
  });

  it('принимает латиницу, нижний регистр и лишние разделители', () => {
    expect(parsePlate('a 123 bc | 777')).toEqual({ letters: 'АВС', number: 123, region: '777' });
    expect(parsePlate('x001xx77')).toEqual({ letters: 'ХХХ', number: 1, region: '77' });
  });

  it('отклоняет цифры 000', () => {
    expect(parsePlate('А000ВС 77')).toBeNull();
  });

  it('отклоняет недопустимые буквы', () => {
    expect(parsePlate('Б123ВС 77')).toBeNull();
    expect(parsePlate('А123ЯС 77')).toBeNull();
    expect(parsePlate('D123BC 77')).toBeNull();
  });

  it('отклоняет кривой регион и формат', () => {
    expect(parsePlate('А123ВС 7')).toBeNull();
    expect(parsePlate('А123ВС 7777')).toBeNull();
    expect(parsePlate('А123ВС 00')).toBeNull();
    expect(parsePlate('А12ВС 77')).toBeNull();
    expect(parsePlate('')).toBeNull();
  });
});

describe('форматирование', () => {
  const p = { letters: 'АВС', number: 7, region: '01' };

  it('добивает цифры нулями', () => {
    expect(formatPlate(p)).toBe('А007ВС 01');
    expect(plateKey(p)).toBe('А007ВС01');
  });

  it('formatPlate и parsePlate обратимы', () => {
    expect(parsePlate(formatPlate(p))).toEqual(p);
  });

  it('isValidPlate', () => {
    expect(isValidPlate(p)).toBe(true);
    expect(isValidPlate({ ...p, number: 0 })).toBe(false);
    expect(isValidPlate({ ...p, number: 1000 })).toBe(false);
    expect(isValidPlate({ ...p, letters: 'АВ' })).toBe(false);
  });
});

describe('регионы', () => {
  it('коды уникальны и валидны', () => {
    const codes = REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^\d{2,3}$/);
  });

  it('столичные регионы есть в общем списке', () => {
    const codes = new Set(REGIONS.map((r) => r.code));
    for (const c of DEFAULT_CAPITAL_REGIONS) expect(codes.has(c)).toBe(true);
  });
});
