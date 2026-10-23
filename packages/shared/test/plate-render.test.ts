import { describe, expect, it } from 'vitest';
import {
  GLYPH_CHARS,
  PLATE_LETTERS,
  PLATE_WIDTH,
  glyphPath,
  parsePlate,
  plateChars,
  plateCharsInnerSvg,
  plateSlots,
  renderPlateCardSvg,
  renderPlateSvg,
} from '../src';

describe('отрисовка номера', () => {
  it('есть глифы для всех букв, цифр и RUS', () => {
    for (const ch of [...PLATE_LETTERS, ...'0123456789', 'R', 'U', 'S']) {
      expect(GLYPH_CHARS).toContain(ch);
      expect(glyphPath(ch, { x: 0, y: 0, w: 10, h: 10 })).toMatch(/^M/);
    }
  });

  it('glyphPath масштабирует координаты в коробку', () => {
    expect(glyphPath('7', { x: 10, y: 20, w: 40, h: 60 })).toBe('M10,20 L50,20 L22,80');
  });

  it('раскладка: 6 + длина региона, всё внутри таблички', () => {
    for (const len of [2, 3]) {
      const slots = plateSlots(len);
      expect(slots).toHaveLength(6 + len);
      for (const s of slots) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.x + s.w).toBeLessThan(PLATE_WIDTH);
      }
    }
  });

  it('маска рисуется звёздочками', () => {
    const svg = plateCharsInnerSvg(['А', '*', '*', '*', 'М', 'Р', '*', '*']);
    expect(svg).not.toContain('NaN');
    expect(GLYPH_CHARS).toContain('*');
  });

  it('окна барабанов не перекрывают соседние символы', () => {
    const slots = plateSlots(3);
    for (let i = 1; i < 6; i++) {
      expect(slots[i]!.clip.x).toBeGreaterThanOrEqual(slots[i - 1]!.clip.x + slots[i - 1]!.clip.w - 8);
    }
  });

  it('символы идут в порядке букв, цифр и региона', () => {
    expect(plateChars(parsePlate('А007ВС 177')!)).toEqual(['А', '0', '0', '7', 'В', 'С', '1', '7', '7']);
  });

  it('renderPlateSvg даёт валидный по виду SVG', () => {
    const svg = renderPlateSvg(parsePlate('А777АА 77')!, { width: 260 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="260" height="56"');
    expect(svg).not.toContain('NaN');
  });

  it('карточка для шаринга содержит табличку и цвет редкости', () => {
    const svg = renderPlateCardSvg(parsePlate('А777АА 77')!, '#FF3D5A');
    expect(svg).toContain('width="1000" height="500"');
    expect(svg).toContain('#FF3D5A');
    expect(svg).toContain('scale(1.55)');
    expect(svg).not.toContain('NaN');
  });
});
