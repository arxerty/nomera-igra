import type { DreamSearchConfig } from './car-config';
import { isPlateLetter, normalizeLetter, plateBody, type Plate } from './plate';

/**
 * Маска поиска по номеру: 6 позиций основной части (буква, 3 цифры, 2 буквы)
 * и необязательный регион. `*` или `?` — любой символ.
 * Примеры: "*777**", "А***АА", "*777** 77", "*1*** 1**".
 */
export interface PlateMask {
  /** 6 позиций; null — любой символ. */
  body: (string | null)[];
  /** Позиции региона (2–3); null у позиции — любая цифра; null целиком — любой регион. */
  region: (string | null)[] | null;
}

const LETTER_POSITIONS = new Set([0, 4, 5]);
const WILDCARDS = new Set(['*', '?']);

export function parseMask(input: string): PlateMask | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length > 2 || !parts[0]) return null;
  const [bodyRaw, regionRaw] = parts as [string, string | undefined];

  const bodyChars = [...bodyRaw];
  if (bodyChars.length !== 6) return null;

  const body: (string | null)[] = [];
  for (const [i, raw] of bodyChars.entries()) {
    if (WILDCARDS.has(raw)) {
      body.push(null);
      continue;
    }
    if (LETTER_POSITIONS.has(i)) {
      const ch = normalizeLetter(raw);
      if (!isPlateLetter(ch)) return null;
      body.push(ch);
    } else {
      if (!/^\d$/.test(raw)) return null;
      body.push(raw);
    }
  }

  let region: (string | null)[] | null = null;
  if (regionRaw !== undefined) {
    const chars = [...regionRaw];
    if (chars.length < 2 || chars.length > 3) return null;
    region = [];
    for (const ch of chars) {
      if (WILDCARDS.has(ch)) region.push(null);
      else if (/^\d$/.test(ch)) region.push(ch);
      else return null;
    }
  }

  return { body, region };
}

/** Сколько позиций маски заданы конкретно (не `*`). */
export function maskFixedChars(mask: PlateMask): number {
  const fixed = (chars: (string | null)[]) => chars.filter((c) => c !== null).length;
  return fixed(mask.body) + (mask.region ? fixed(mask.region) : 0);
}

/** Маска для «Номера мечты» должна быть достаточно конкретной, чтобы не ловить всё подряд. */
export function isAcceptableDreamMask(mask: PlateMask, cfg: DreamSearchConfig): boolean {
  return maskFixedChars(mask) >= cfg.minFixedChars;
}

function matchChars(value: string, pattern: (string | null)[]): boolean {
  const chars = [...value];
  return chars.length === pattern.length && pattern.every((p, i) => p === null || p === chars[i]);
}

export function matchesMask(plate: Plate, mask: PlateMask): boolean {
  if (!matchChars(plateBody(plate), mask.body)) return false;
  return mask.region === null || matchChars(plate.region, mask.region);
}

/**
 * Шаблоны для SQL LIKE по колонкам `body` и `region`.
 * Символы маски — только буквы номера и цифры, экранирование не требуется.
 */
export function maskToSqlLike(mask: PlateMask): { body: string; region: string | null } {
  const toLike = (chars: (string | null)[]) => chars.map((c) => c ?? '_').join('');
  return { body: toLike(mask.body), region: mask.region ? toLike(mask.region) : null };
}
