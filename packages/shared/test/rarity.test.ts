import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, classifyPlate, parsePlate, type RarityRules, type Tier } from '../src';

const rules: RarityRules = DEFAULT_GAME_CONFIG.rarity;

function classify(input: string, r: RarityRules = rules) {
  const plate = parsePlate(input);
  if (!plate) throw new Error(`bad plate in test: ${input}`);
  return classifyPlate(plate, r);
}

const tierCases: [string, Tier][] = [
  // Обычный
  ['А245ВС 50', 'common'],
  ['К392МР 16', 'common'],
  // Необычный: две одинаковые подряд, зеркальные
  ['А112ВС 50', 'uncommon'],
  ['А211ВС 50', 'uncommon'],
  ['А121ВС 50', 'uncommon'],
  ['А090ВС 50', 'uncommon'],
  ['А010ВС 50', 'uncommon'],
  // Редкий: три одинаковые, круглые, последовательности
  ['А555ВС 50', 'rare'],
  ['А111ВС 50', 'rare'],
  ['А100ВС 50', 'rare'],
  ['А900ВС 50', 'rare'],
  ['А123ВС 77', 'rare'],
  ['А789ВС 50', 'rare'],
  ['А321ВС 50', 'rare'],
  ['А012ВС 50', 'rare'],
  // Эпический: одинаковые буквы или 001–009
  ['А123АА 50', 'epic'],
  ['М245ММ 50', 'epic'],
  ['А001ВС 50', 'epic'],
  ['А009ВС 50', 'epic'],
  ['А001АА 50', 'epic'],
  ['А007АА 77', 'epic'],
  // Легендарный: одинаковые буквы и цифры, VIP-серия
  ['А777АА 50', 'legendary'],
  ['О555ОО 77', 'legendary'],
  ['Е245КХ 50', 'legendary'],
  ['А001МР 77', 'legendary'],
  // Мифический: одинаковые буквы + 001/777 + столица
  ['А001АА 77', 'mythic'],
  ['А777АА 77', 'mythic'],
  ['Х001ХХ 197', 'mythic'],
  ['М777ММ 78', 'mythic'],
];

describe('classifyPlate: тиры', () => {
  it.each(tierCases)('%s → %s', (plate, tier) => {
    expect(classify(plate).tier).toBe(tier);
  });
});

describe('classifyPlate: признаки', () => {
  it('у тройных цифр нет «двух подряд» и «зеркала»', () => {
    expect(classify('А777ВС 50').traits).toEqual(['triple_digits']);
  });

  it('001 — только low_number, без double_digits', () => {
    expect(classify('А001ВС 50').traits).toEqual(['low_number']);
  });

  it('признаки отсортированы от старшего к младшему', () => {
    expect(classify('А777АА 77').traits).toEqual([
      'mythic_combo',
      'same_letters_same_digits',
      'same_letters',
      'triple_digits',
    ]);
  });

  it('обычный номер без признаков', () => {
    expect(classify('А245ВС 50').traits).toEqual([]);
  });

  it('число 112 даёт и «две подряд», и не зеркало', () => {
    expect(classify('А112ВС 50').traits).toEqual(['double_digits']);
  });
});

describe('classifyPlate: VIP-серии', () => {
  it('VIP с ограничением по региону', () => {
    const r: RarityRules = { ...rules, vipSeries: [{ letters: 'ЕКХ', regions: ['77'] }] };
    expect(classify('Е245КХ 77', r).tier).toBe('legendary');
    expect(classify('Е245КХ 50', r).tier).toBe('common');
  });

  it('пустой список VIP', () => {
    const r: RarityRules = { ...rules, vipSeries: [] };
    expect(classify('Е245КХ 50', r).tier).toBe('common');
  });

  it('мифические числа настраиваются', () => {
    const r: RarityRules = { ...rules, mythicNumbers: [7] };
    expect(classify('А007АА 77', r).tier).toBe('mythic');
    expect(classify('А001АА 77', r).tier).toBe('epic');
  });
});

describe('бонусы', () => {
  it('совпадение цифр с регионом — числовое равенство', () => {
    expect(classify('А077ВС 77').bonuses).toContain('region_match');
    expect(classify('А161ВС 161').bonuses).toContain('region_match');
    expect(classify('А001ВС 01').bonuses).toContain('region_match');
    expect(classify('А777ВС 777').bonuses).toContain('region_match');
    expect(classify('А177ВС 77').bonuses).not.toContain('region_match');
    expect(classify('А770ВС 77').bonuses).not.toContain('region_match');
  });

  it('палиндром: первая буква = последней и цифры-палиндром', () => {
    expect(classify('А121ВА 50').bonuses).toContain('palindrome');
    expect(classify('К787МК 50').bonuses).toContain('palindrome');
    expect(classify('А777АА 50').bonuses).toContain('palindrome');
    expect(classify('А121ВС 50').bonuses).not.toContain('palindrome');
    expect(classify('А123ВА 50').bonuses).not.toContain('palindrome');
  });

  it('бонусы не меняют тир', () => {
    expect(classify('А245ВС 245').tier).toBe('common');
    expect(classify('А245ВС 245').bonuses).toEqual(['region_match']);
  });
});
