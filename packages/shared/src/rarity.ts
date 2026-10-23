import { digitsOf, type Plate } from './plate';

export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_RANK: Record<Tier, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

export function compareTiers(a: Tier, b: Tier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

export function tierBelow(tier: Tier): Tier | null {
  const rank = TIER_RANK[tier];
  return rank === 0 ? null : (TIERS[rank - 1] as Tier);
}

/** Тиры, начиная с которых выпадение сопровождается особой анимацией. */
export function isSpecialTier(tier: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK.epic;
}

export type TraitId =
  | 'double_digits'
  | 'mirror_digits'
  | 'triple_digits'
  | 'round_number'
  | 'sequence'
  | 'same_letters'
  | 'low_number'
  | 'same_letters_same_digits'
  | 'vip_series'
  | 'mythic_combo';

export const TRAIT_TIER: Record<TraitId, Tier> = {
  double_digits: 'uncommon',
  mirror_digits: 'uncommon',
  triple_digits: 'rare',
  round_number: 'rare',
  sequence: 'rare',
  same_letters: 'epic',
  low_number: 'epic',
  same_letters_same_digits: 'legendary',
  vip_series: 'legendary',
  mythic_combo: 'mythic',
};

export type BonusId = 'region_match' | 'palindrome';
export const BONUS_IDS: readonly BonusId[] = ['region_match', 'palindrome'];

export interface VipSeries {
  /** Три буквы номера по порядку, например "ЕКХ" для Е***КХ. */
  letters: string;
  /** Если задано, серия считается VIP только в этих регионах. */
  regions?: string[];
}

export interface RarityRules {
  vipSeries: VipSeries[];
  capitalRegions: string[];
  /** Цифры, дающие мифик при одинаковых буквах и столичном регионе. */
  mythicNumbers: number[];
}

export interface RarityResult {
  tier: Tier;
  /** Все совпавшие признаки, от старшего к младшему. */
  traits: TraitId[];
  bonuses: BonusId[];
}

export function isTripleDigits(n: number): boolean {
  const [a, b, c] = digitsOf(n);
  return a === b && b === c;
}

/**
 * Признаки, зависящие только от цифр. Более общий признак не дублирует
 * более сильный: у 777 нет «двух одинаковых подряд», у 100 и 005 тоже.
 */
export function digitTraits(n: number): TraitId[] {
  const [a, b, c] = digitsOf(n);
  const traits: TraitId[] = [];

  const low = n >= 1 && n <= 9;
  const triple = a === b && b === c;
  const round = n >= 100 && n % 100 === 0;
  const step = b - a;
  const sequence = (step === 1 || step === -1) && c - b === step;

  if (low) traits.push('low_number');
  if (triple) traits.push('triple_digits');
  if (round) traits.push('round_number');
  if (sequence) traits.push('sequence');

  if (!low && !triple && !round) {
    if (a === b || b === c) traits.push('double_digits');
    if (a === c) traits.push('mirror_digits');
  }
  return traits;
}

/** Тир, который дают одни только цифры (без учёта букв и региона). */
export function digitTier(n: number): Tier {
  return maxTier(digitTraits(n).map((t) => TRAIT_TIER[t]));
}

export function isSameLetters(letters: string): boolean {
  return letters[0] === letters[1] && letters[1] === letters[2];
}

export function isVipSeries(plate: Plate, vipSeries: VipSeries[]): boolean {
  return vipSeries.some(
    (v) => v.letters === plate.letters && (!v.regions || v.regions.includes(plate.region)),
  );
}

export function plateBonuses(plate: Plate): BonusId[] {
  const bonuses: BonusId[] = [];
  if (plate.number === Number(plate.region)) bonuses.push('region_match');
  const [a, , c] = digitsOf(plate.number);
  if (plate.letters[0] === plate.letters[2] && a === c) bonuses.push('palindrome');
  return bonuses;
}

function maxTier(tiers: Tier[]): Tier {
  let best: Tier = 'common';
  for (const t of tiers) if (TIER_RANK[t] > TIER_RANK[best]) best = t;
  return best;
}

export function classifyPlate(plate: Plate, rules: RarityRules): RarityResult {
  const traits = digitTraits(plate.number);
  const sameLetters = isSameLetters(plate.letters);

  if (sameLetters) {
    traits.push('same_letters');
    if (isTripleDigits(plate.number)) traits.push('same_letters_same_digits');
    if (
      rules.mythicNumbers.includes(plate.number) &&
      rules.capitalRegions.includes(plate.region)
    ) {
      traits.push('mythic_combo');
    }
  }
  if (isVipSeries(plate, rules.vipSeries)) traits.push('vip_series');

  traits.sort((x, y) => TIER_RANK[TRAIT_TIER[y]] - TIER_RANK[TRAIT_TIER[x]]);

  return {
    tier: maxTier(traits.map((t) => TRAIT_TIER[t])),
    traits,
    bonuses: plateBonuses(plate),
  };
}
