import type { TierOdds } from './config';
import { MAX_PLATE_NUMBER, MIN_PLATE_NUMBER, PLATE_LETTERS, type Plate } from './plate';
import {
  TIERS,
  classifyPlate,
  digitTier,
  isTripleDigits,
  tierBelow,
  type RarityResult,
  type RarityRules,
  type Tier,
} from './rarity';

/** Источник случайности. На сервере — crypto.randomInt, в тестах — сидированный ГПСЧ. */
export interface Rng {
  /** Равномерное целое из [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Детерминированный ГПСЧ (mulberry32) для тестов и симуляций. НЕ для боевых выбиваний. */
export function createSeededRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (max) => Math.floor(next() * max) };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.int(items.length)]!;
}

export function rollTier(odds: TierOdds, rng: Rng): Tier {
  const total = TIERS.reduce((sum, t) => sum + odds[t], 0);
  if (total <= 0) throw new Error('Сумма весов шансов должна быть больше нуля');
  let r = rng.int(total);
  for (const t of TIERS) {
    if (r < odds[t]) return t;
    r -= odds[t];
  }
  throw new Error('unreachable');
}

const ALL_NUMBERS: readonly number[] = Array.from(
  { length: MAX_PLATE_NUMBER - MIN_PLATE_NUMBER + 1 },
  (_, i) => i + MIN_PLATE_NUMBER,
);
const TRIPLE_NUMBERS = ALL_NUMBERS.filter(isTripleDigits);
const NON_TRIPLE_NUMBERS = ALL_NUMBERS.filter((n) => !isTripleDigits(n));
const NUMBERS_BY_DIGIT_TIER = Object.fromEntries(
  TIERS.map((t) => [t, ALL_NUMBERS.filter((n) => digitTier(n) === t)]),
) as Record<Tier, number[]>;
const SAME_LETTER_SERIES = PLATE_LETTERS.map((l) => l + l + l);

/** Шаблон, из которого номер выбирается равномерно. `'any'` — любые три буквы. */
interface Pattern {
  letters: readonly string[] | 'any';
  numbers: readonly number[];
  regions: readonly string[];
}

export interface GeneratorConfig {
  regions: readonly string[];
  rarity: RarityRules;
}

/**
 * Способы получить номер заданного тира. Внешний массив — «виды» номеров тира,
 * которые выпадают равновероятно (например, у легендарки: А777АА и VIP-серия);
 * внутри вида шаблоны тоже равновероятны.
 */
function patternKinds(tier: Tier, cfg: GeneratorConfig): Pattern[][] {
  const all = cfg.regions;
  const capital = all.filter((r) => cfg.rarity.capitalRegions.includes(r));
  const normal = (numbers: readonly number[]): Pattern[][] => [
    [{ letters: 'any', numbers, regions: all }],
  ];

  let kinds: Pattern[][];
  switch (tier) {
    case 'common':
    case 'uncommon':
    case 'rare':
      kinds = normal(NUMBERS_BY_DIGIT_TIER[tier]);
      break;
    case 'epic':
      kinds = [
        [{ letters: SAME_LETTER_SERIES, numbers: NON_TRIPLE_NUMBERS, regions: all }],
        [{ letters: 'any', numbers: NUMBERS_BY_DIGIT_TIER.epic, regions: all }],
      ];
      break;
    case 'legendary':
      kinds = [
        [{ letters: SAME_LETTER_SERIES, numbers: TRIPLE_NUMBERS, regions: all }],
        cfg.rarity.vipSeries.map((v) => ({
          letters: [v.letters],
          numbers: ALL_NUMBERS,
          regions: v.regions ? all.filter((r) => v.regions!.includes(r)) : all,
        })),
      ];
      break;
    case 'mythic':
      kinds = [
        [{ letters: SAME_LETTER_SERIES, numbers: cfg.rarity.mythicNumbers, regions: capital }],
      ];
      break;
  }

  return kinds
    .map((kind) =>
      kind.filter(
        (p) => p.numbers.length > 0 && p.regions.length > 0 && (p.letters === 'any' || p.letters.length > 0),
      ),
    )
    .filter((kind) => kind.length > 0);
}

function samplePattern(p: Pattern, rng: Rng): Plate {
  const letters =
    p.letters === 'any'
      ? pick(rng, PLATE_LETTERS) + pick(rng, PLATE_LETTERS) + pick(rng, PLATE_LETTERS)
      : pick(rng, p.letters);
  return { letters, number: pick(rng, p.numbers), region: pick(rng, p.regions) };
}

/**
 * Строит случайный номер ровно указанного тира.
 * Шаблон даёт кандидата, classifyPlate проверяет его: так генератор никогда
 * не разойдётся с правилами редкости. Возвращает null, если тир недостижим
 * при текущем конфиге (например, нет столичных регионов в списке выдачи).
 */
export function generatePlate(
  tier: Tier,
  rng: Rng,
  cfg: GeneratorConfig,
  maxAttempts = 200,
): Plate | null {
  const kinds = patternKinds(tier, cfg);
  if (kinds.length === 0) return null;
  for (let i = 0; i < maxAttempts; i++) {
    const plate = samplePattern(pick(rng, pick(rng, kinds)), rng);
    if (classifyPlate(plate, cfg.rarity).tier === tier) return plate;
  }
  return null;
}

export interface RolledPlate {
  plate: Plate;
  rarity: RarityResult;
  /** Тир, выпавший по шансам. Может быть выше итогового, если свободных номеров тира не осталось. */
  rolledTier: Tier;
}

/**
 * Выбивает уникальный номер: тир по шансам, затем номер этого тира, свободный
 * в игре. Если за `attemptsPerTier` попыток свободного номера не нашлось,
 * спускается на тир ниже. `tryClaim` атомарно занимает номер (на сервере —
 * INSERT … ON CONFLICT в БД) и возвращает false, если номер уже чей-то.
 */
export async function rollUniquePlate(opts: {
  odds: TierOdds;
  rng: Rng;
  config: GeneratorConfig;
  tryClaim: (plate: Plate, rarity: RarityResult) => Promise<boolean>;
  attemptsPerTier?: number;
}): Promise<RolledPlate | null> {
  const { rng, config, tryClaim, attemptsPerTier = 20 } = opts;
  const rolledTier = rollTier(opts.odds, rng);

  for (let tier: Tier | null = rolledTier; tier; tier = tierBelow(tier)) {
    for (let i = 0; i < attemptsPerTier; i++) {
      const plate = generatePlate(tier, rng, config);
      if (!plate) break;
      const rarity = classifyPlate(plate, config.rarity);
      if (await tryClaim(plate, rarity)) return { plate, rarity, rolledTier };
    }
  }
  return null;
}
