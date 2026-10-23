/**
 * Формат российского номера типа 1: буква, 3 цифры, 2 буквы, регион.
 * Пример: А123ВС 77. Буквы хранятся в кириллице; латинские двойники
 * (A, B, E, K, M, H, O, P, C, T, Y, X) при вводе приводятся к кириллице.
 */

export const PLATE_LETTERS = ['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'] as const;
export type PlateLetter = (typeof PLATE_LETTERS)[number];

export const MIN_PLATE_NUMBER = 1;
export const MAX_PLATE_NUMBER = 999;

const LETTER_SET = new Set<string>(PLATE_LETTERS);

const LATIN_TO_CYRILLIC: Record<string, PlateLetter> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  Y: 'У',
  X: 'Х',
};

export interface Plate {
  /** Три буквы по порядку: первая буква номера, затем две буквы серии. */
  letters: string;
  /** Число 1..999, отображается тремя цифрами. */
  number: number;
  /** Код региона, 2–3 цифры, с ведущим нулём для однозначных ("01"). */
  region: string;
}

/** Приводит символ к канонической кириллической букве номера, если это возможно. */
export function normalizeLetter(ch: string): string {
  const upper = ch.toUpperCase();
  return LATIN_TO_CYRILLIC[upper] ?? upper;
}

export function isPlateLetter(ch: string): ch is PlateLetter {
  return LETTER_SET.has(ch);
}

export function isValidRegionCode(region: string): boolean {
  return /^\d{2,3}$/.test(region) && region !== '00' && region !== '000';
}

export function formatDigits(n: number): string {
  return String(n).padStart(3, '0');
}

/** Основная часть номера без региона: "А123ВС". */
export function plateBody(p: Plate): string {
  return `${p.letters[0]}${formatDigits(p.number)}${p.letters.slice(1)}`;
}

/** Уникальный ключ номера в игре: "А123ВС77". */
export function plateKey(p: Plate): string {
  return `${plateBody(p)}${p.region}`;
}

/** Человекочитаемый вид: "А123ВС 77". */
export function formatPlate(p: Plate): string {
  return `${plateBody(p)} ${p.region}`;
}

export function isValidPlate(p: Plate): boolean {
  return (
    p.letters.length === 3 &&
    [...p.letters].every(isPlateLetter) &&
    Number.isInteger(p.number) &&
    p.number >= MIN_PLATE_NUMBER &&
    p.number <= MAX_PLATE_NUMBER &&
    isValidRegionCode(p.region)
  );
}

const PLATE_RE = /^([АВЕКМНОРСТУХ])(\d{3})([АВЕКМНОРСТУХ]{2})(\d{2,3})$/u;

/**
 * Разбирает строку вида "А123ВС 77", "a123bc77", "А 123 ВС | 777".
 * Возвращает null для некорректного номера (в том числе с цифрами 000).
 */
export function parsePlate(input: string): Plate | null {
  const compact = [...input.replace(/[\s|_-]/g, '')].map(normalizeLetter).join('');
  const m = PLATE_RE.exec(compact);
  if (!m) return null;
  const [, first, digits, series, region] = m as unknown as [string, string, string, string, string];
  const plate: Plate = { letters: first + series, number: Number(digits), region };
  return isValidPlate(plate) ? plate : null;
}

export function digitsOf(n: number): [number, number, number] {
  return [Math.floor(n / 100), Math.floor(n / 10) % 10, n % 10];
}
