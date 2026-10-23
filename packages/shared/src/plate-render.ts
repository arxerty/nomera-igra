/**
 * Векторная отрисовка номерного знака по пропорциям ГОСТ Р 50577 (тип 1, 520×112 мм).
 * Чёрная основа с двумя белыми полями — основная часть и блок региона.
 * Символы — собственные штриховые глифы в духе номерного шрифта: жирный равномерный
 * штрих, прямые срезы концов. Шрифтовые файлы не нужны, поэтому одна и та же
 * отрисовка работает в Mini App и при рендере PNG-карточек на сервере.
 */
import { formatDigits, type Plate } from './plate';

export const PLATE_WIDTH = 520;
export const PLATE_HEIGHT = 112;

/** Толщина штриха глифов основной части и региона, мм. */
export const GLYPH_STROKE = 10.5;
const RUS_STROKE = 3.4;

/** Белые поля таблички: основная часть и регион. Между ними — чёрный разделитель. */
const MAIN_FIELD = { x: 6, y: 6, w: 380, h: 100 };
const REGION_FIELD = { x: 392, y: 6, w: 122, h: 100 };

/**
 * Глифы в нормированных координатах: x, y ∈ [0, 1], (0, 0) — левый верхний угол
 * коробки по центрам штрихов. Только абсолютные команды M, L, C, Z.
 */
const GLYPHS: Record<string, string> = {
  '0': 'M0.5,0 C0.84,0 1,0.13 1,0.32 L1,0.68 C1,0.87 0.84,1 0.5,1 C0.16,1 0,0.87 0,0.68 L0,0.32 C0,0.13 0.16,0 0.5,0 Z',
  '1': 'M0.06,0.27 L0.64,0 L0.64,1',
  '2': 'M0.02,0.27 C0.04,0.1 0.22,0 0.5,0 C0.8,0 0.98,0.11 0.98,0.29 C0.98,0.44 0.86,0.53 0.64,0.64 L0,1 L1,1',
  '3': 'M0.03,0.21 C0.09,0.07 0.27,0 0.5,0 C0.78,0 0.96,0.1 0.96,0.25 C0.96,0.39 0.78,0.46 0.44,0.46 C0.8,0.46 1,0.57 1,0.73 C1,0.9 0.8,1 0.5,1 C0.24,1 0.06,0.93 0,0.79',
  '4': 'M0.76,1 L0.76,0 L0,0.69 L1,0.69',
  '5': 'M0.94,0 L0.1,0 L0.04,0.45 C0.18,0.39 0.34,0.37 0.52,0.37 C0.82,0.37 1,0.49 1,0.68 C1,0.88 0.8,1 0.5,1 C0.25,1 0.06,0.93 0,0.8',
  '6': 'M0.9,0.09 C0.8,0.03 0.67,0 0.52,0 C0.2,0 0,0.12 0,0.34 L0,0.7 C0,0.89 0.2,1 0.5,1 C0.8,1 1,0.89 1,0.7 C1,0.52 0.82,0.42 0.52,0.42 C0.26,0.42 0.06,0.49 0,0.6',
  '7': 'M0,0 L1,0 L0.3,1',
  '8': 'M0.5,0.46 C0.22,0.46 0.06,0.37 0.06,0.23 C0.06,0.08 0.24,0 0.5,0 C0.76,0 0.94,0.08 0.94,0.23 C0.94,0.37 0.78,0.46 0.5,0.46 C0.2,0.46 0,0.56 0,0.73 C0,0.9 0.21,1 0.5,1 C0.79,1 1,0.9 1,0.73 C1,0.56 0.8,0.46 0.5,0.46 Z',
  А: 'M0,1 L0.5,0 L1,1 M0.2,0.66 L0.8,0.66',
  В: 'M0,0.48 L0.62,0.48 C0.87,0.48 1,0.58 1,0.74 C1,0.9 0.87,1 0.62,1 L0,1 L0,0 L0.56,0 C0.79,0 0.93,0.09 0.93,0.24 C0.93,0.39 0.79,0.48 0.56,0.48',
  Е: 'M1,0 L0,0 L0,1 L1,1 M0,0.48 L0.84,0.48',
  К: 'M0,0 L0,1 M0.98,0 L0,0.6 M0.34,0.4 L1,1',
  М: 'M0,1 L0,0 L0.5,0.64 L1,0 L1,1',
  Н: 'M0,0 L0,1 M1,0 L1,1 M0,0.48 L1,0.48',
  О: 'M0.5,0 C0.84,0 1,0.13 1,0.32 L1,0.68 C1,0.87 0.84,1 0.5,1 C0.16,1 0,0.87 0,0.68 L0,0.32 C0,0.13 0.16,0 0.5,0 Z',
  Р: 'M0,1 L0,0 L0.6,0 C0.87,0 1,0.12 1,0.29 C1,0.46 0.87,0.57 0.6,0.57 L0,0.57',
  С: 'M1,0.21 C0.94,0.07 0.74,0 0.5,0 C0.18,0 0,0.13 0,0.32 L0,0.68 C0,0.87 0.18,1 0.5,1 C0.74,1 0.94,0.93 1,0.79',
  Т: 'M0,0 L1,0 M0.5,0 L0.5,1',
  У: 'M0,0 L0.5,0.56 M1,0 L0.5,0.56 L0.5,1',
  Х: 'M0,0 L1,1 M1,0 L0,1',
  R: 'M0,1 L0,0 L0.6,0 C0.86,0 1,0.12 1,0.28 C1,0.44 0.86,0.56 0.6,0.56 L0,0.56 M0.5,0.56 L1,1',
  U: 'M0,0 L0,0.72 C0,0.9 0.22,1 0.5,1 C0.78,1 1,0.9 1,0.72 L1,0',
  S: 'M1,0.18 C0.92,0.06 0.72,0 0.5,0 C0.22,0 0.02,0.1 0.02,0.27 C0.02,0.45 0.25,0.5 0.5,0.52 C0.78,0.54 1,0.6 1,0.77 C1,0.92 0.78,1 0.5,1 C0.26,1 0.07,0.94 0,0.82',
  // Подстановочный символ для масок и VIP-серий: «А***МР».
  '*': 'M0.5,0.1 L0.5,0.72 M-0.08,0.25 L1.08,0.57 M1.08,0.25 L-0.08,0.57',
};
// «9» — это «6», повёрнутая на 180°.
GLYPHS['9'] = GLYPHS['6']!.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_, x: string, y: string) =>
  `${round(1 - Number(x))},${round(1 - Number(y))}`,
);

function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export interface GlyphBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Путь глифа, вписанный в коробку (по центрам штрихов) в мм. */
export function glyphPath(ch: string, box: GlyphBox): string {
  const src = GLYPHS[ch];
  if (!src) return '';
  return src.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_, x: string, y: string) =>
    `${round(box.x + Number(x) * box.w)},${round(box.y + Number(y) * box.h)}`,
  );
}

export type SlotKind = 'letter' | 'digit' | 'region';

export interface PlateSlot extends GlyphBox {
  kind: SlotKind;
  /** Индекс символа в строке plateChars(). */
  index: number;
  /** Окно видимости символа (для слот-анимации барабанов). */
  clip: GlyphBox;
}

// Основная часть: буквы 58 мм, цифры 76 мм по внешнему контуру, общая нижняя линия.
const BASELINE = 94 - GLYPH_STROKE / 2;
const LETTER_TOP = 36 + GLYPH_STROKE / 2;
const DIGIT_TOP = 18 + GLYPH_STROKE / 2;
const LETTER_OUTER_W = 50;
const DIGIT_OUTER_W = 46;
/** Левые края символов по внешнему контуру: Б · ЦЦЦ · ББ. */
const MAIN_OUTER_X = [25, 89, 143, 197, 257, 315];
const MAIN_KINDS: SlotKind[] = ['letter', 'digit', 'digit', 'digit', 'letter', 'letter'];

const REGION_TOP = 12 + GLYPH_STROKE / 2;
const REGION_BOTTOM = 72 - GLYPH_STROKE / 2;

/** Раскладка символов номера: 6 позиций основной части + 2–3 позиции региона. */
export function plateSlots(regionLength: number): PlateSlot[] {
  const half = GLYPH_STROKE / 2;
  const mainClip = { y: MAIN_FIELD.y + 2, h: MAIN_FIELD.h - 4 };
  const slots: PlateSlot[] = MAIN_OUTER_X.map((ox, i) => {
    const kind = MAIN_KINDS[i]!;
    const outerW = kind === 'letter' ? LETTER_OUTER_W : DIGIT_OUTER_W;
    const top = kind === 'letter' ? LETTER_TOP : DIGIT_TOP;
    return {
      kind,
      index: i,
      x: ox + half,
      y: top,
      w: outerW - GLYPH_STROKE,
      h: BASELINE - top,
      clip: { x: ox - 4, w: outerW + 8, ...mainClip },
    };
  });

  const outerW = regionLength === 3 ? 34 : 42;
  const gap = regionLength === 3 ? 4 : 8;
  const total = regionLength * outerW + (regionLength - 1) * gap;
  let ox = REGION_FIELD.x + (REGION_FIELD.w - total) / 2;
  for (let i = 0; i < regionLength; i++) {
    slots.push({
      kind: 'region',
      index: 6 + i,
      x: ox + half,
      y: REGION_TOP,
      w: outerW - GLYPH_STROKE,
      h: REGION_BOTTOM - REGION_TOP,
      clip: { x: ox - 2, y: REGION_FIELD.y + 2, w: outerW + 4, h: 70 },
    });
    ox += outerW + gap;
  }
  return slots;
}

/** Символы номера в порядке отрисовки: "А123ВС" + регион. */
export function plateChars(p: Plate): string[] {
  return [p.letters[0]!, ...formatDigits(p.number), p.letters[1]!, p.letters[2]!, ...p.region];
}

export const PLATE_COLORS = {
  plate: '#FFFFFF',
  ink: '#0E0E0E',
  flagWhite: '#FFFFFF',
  flagBlue: '#0039A6',
  flagRed: '#D52B1E',
};

/** Неизменная часть таблички: чёрная основа, белые поля, «RUS» и флаг. */
export function plateFrameSvg(): string {
  const c = PLATE_COLORS;
  const m = MAIN_FIELD;
  const r = REGION_FIELD;
  const rus = ['R', 'U', 'S']
    .map((ch, i) => glyphPath(ch, { x: 409 + i * 19, y: 81, w: 12, h: 15 }))
    .join(' ');
  const fx = 468;
  const fy = 80;
  const fw = 30;
  const fh = 18;
  return [
    `<rect x="0" y="0" width="${PLATE_WIDTH}" height="${PLATE_HEIGHT}" rx="13" fill="${c.ink}"/>`,
    `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="8" fill="${c.plate}"/>`,
    `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="${c.plate}"/>`,
    `<path d="${rus}" fill="none" stroke="${c.ink}" stroke-width="${RUS_STROKE}" stroke-linejoin="round"/>`,
    `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh / 3}" fill="${c.flagWhite}"/>`,
    `<rect x="${fx}" y="${fy + fh / 3}" width="${fw}" height="${fh / 3}" fill="${c.flagBlue}"/>`,
    `<rect x="${fx}" y="${fy + (2 * fh) / 3}" width="${fw}" height="${fh / 3}" fill="${c.flagRed}"/>`,
    `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="${c.ink}" stroke-width="0.8"/>`,
  ].join('');
}

export const GLYPH_STROKE_ATTRS = `fill="none" stroke="${PLATE_COLORS.ink}" stroke-width="${GLYPH_STROKE}" stroke-linecap="butt" stroke-linejoin="round"`;

/**
 * Содержимое таблички по произвольным символам (рамка + символы) в координатах 520×112.
 * `chars` — 6 символов основной части и 2–3 символа региона; `*` рисуется звёздочкой.
 */
export function plateCharsInnerSvg(chars: readonly string[]): string {
  const regionLength = Math.min(3, Math.max(2, chars.length - 6));
  const d = plateSlots(regionLength)
    .map((s) => glyphPath(chars[s.index] ?? '', s))
    .join(' ');
  return plateFrameSvg() + `<path d="${d}" ${GLYPH_STROKE_ATTRS}/>`;
}

/** Содержимое таблички (рамка + символы) в координатах 520×112, без обёртки <svg>. */
export function plateInnerSvg(p: Plate): string {
  return plateCharsInnerSvg(plateChars(p));
}

/** Номер целиком как самостоятельный SVG. */
export function renderPlateSvg(p: Plate, opts: { width?: number } = {}): string {
  const width = opts.width ?? PLATE_WIDTH;
  const height = Math.round((width * PLATE_HEIGHT) / PLATE_WIDTH);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PLATE_WIDTH} ${PLATE_HEIGHT}" width="${width}" height="${height}">` +
    plateInnerSvg(p) +
    `</svg>`
  );
}

export const CARD_WIDTH = 1000;
export const CARD_HEIGHT = 500;

/**
 * Карточка для шаринга (1000×500): светлая панель в стиле приложения, полоса
 * цвета редкости и табличка по центру. Без текста — подпись идёт в сообщении Telegram.
 */
export function renderPlateCardSvg(p: Plate, color: string): string {
  const scale = 1.55;
  const x = (CARD_WIDTH - PLATE_WIDTH * scale) / 2;
  const y = (CARD_HEIGHT - PLATE_HEIGHT * scale) / 2 + 10;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">` +
    `<defs><clipPath id="card"><rect x="30" y="30" width="${CARD_WIDTH - 60}" height="${CARD_HEIGHT - 60}" rx="22"/></clipPath></defs>` +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#EEF1F5"/>` +
    `<g clip-path="url(#card)"><rect x="30" y="30" width="${CARD_WIDTH - 60}" height="${CARD_HEIGHT - 60}" fill="#FFFFFF"/>` +
    `<rect x="30" y="30" width="${CARD_WIDTH - 60}" height="14" fill="${color}"/></g>` +
    `<rect x="30" y="30" width="${CARD_WIDTH - 60}" height="${CARD_HEIGHT - 60}" rx="22" fill="none" stroke="#DDE2EA" stroke-width="2"/>` +
    `<rect x="${x + 6}" y="${y + 10}" width="${PLATE_WIDTH * scale}" height="${PLATE_HEIGHT * scale}" rx="20" fill="#000000" fill-opacity="0.12"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale})">${plateInnerSvg(p)}</g>` +
    `</svg>`
  );
}

/** Символы, для которых есть глифы (для тестов и колёс слот-анимации). */
export const GLYPH_CHARS = Object.keys(GLYPHS);
