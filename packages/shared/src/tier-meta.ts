import type { BonusId, Tier, TraitId } from './rarity';

export type Locale = 'ru' | 'en';

/** Неоновый цвет тира — общий для фронтенда и карточек бота. */
export const TIER_COLORS: Record<Tier, string> = {
  common: '#9AA3AF',
  uncommon: '#3DDC84',
  rare: '#3D8BFF',
  epic: '#B05CFF',
  legendary: '#FFC53D',
  mythic: '#FF3D5A',
};

export const TIER_NAMES: Record<Locale, Record<Tier, string>> = {
  ru: {
    common: 'Обычный',
    uncommon: 'Необычный',
    rare: 'Редкий',
    epic: 'Эпический',
    legendary: 'Легендарный',
    mythic: 'Мифический',
  },
  en: {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
    mythic: 'Mythic',
  },
};

export const TRAIT_NAMES: Record<Locale, Record<TraitId, string>> = {
  ru: {
    double_digits: 'Две одинаковые цифры подряд',
    mirror_digits: 'Зеркальные цифры',
    triple_digits: 'Три одинаковые цифры',
    round_number: 'Круглый номер',
    sequence: 'Последовательность',
    same_letters: 'Одинаковые буквы',
    low_number: 'Цифры 001–009',
    same_letters_same_digits: 'Одинаковые буквы и цифры',
    vip_series: 'VIP-серия',
    mythic_combo: 'Столичный блатной номер',
  },
  en: {
    double_digits: 'Two matching digits in a row',
    mirror_digits: 'Mirrored digits',
    triple_digits: 'Triple digits',
    round_number: 'Round number',
    sequence: 'Sequence',
    same_letters: 'Matching letters',
    low_number: 'Digits 001–009',
    same_letters_same_digits: 'Matching letters and digits',
    vip_series: 'VIP series',
    mythic_combo: 'Capital VIP plate',
  },
};

export const BONUS_NAMES: Record<Locale, Record<BonusId, string>> = {
  ru: { region_match: 'Цифры совпадают с регионом', palindrome: 'Номер-палиндром' },
  en: { region_match: 'Digits match the region', palindrome: 'Palindrome plate' },
};
