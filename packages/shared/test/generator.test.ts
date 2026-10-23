import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  TIERS,
  classifyPlate,
  createSeededRng,
  generatePlate,
  isValidPlate,
  plateKey,
  rollTier,
  rollUniquePlate,
  type GeneratorConfig,
  type Plate,
} from '../src';

const cfg: GeneratorConfig = {
  regions: DEFAULT_GAME_CONFIG.regions,
  rarity: DEFAULT_GAME_CONFIG.rarity,
};

describe('generatePlate', () => {
  it.each(TIERS)('тир %s: каждый номер валиден и ровно этого тира', (tier) => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 400; i++) {
      const plate = generatePlate(tier, rng, cfg);
      expect(plate).not.toBeNull();
      expect(isValidPlate(plate!)).toBe(true);
      expect(classifyPlate(plate!, cfg.rarity).tier).toBe(tier);
      expect(cfg.regions).toContain(plate!.region);
    }
  });

  it('легендарки выпадают обоих видов: А777АА и VIP-серии', () => {
    const rng = createSeededRng(7);
    const traits = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const plate = generatePlate('legendary', rng, cfg)!;
      for (const t of classifyPlate(plate, cfg.rarity).traits) traits.add(t);
    }
    expect(traits).toContain('same_letters_same_digits');
    expect(traits).toContain('vip_series');
  });

  it('мифик недостижим без столичных регионов в выдаче', () => {
    const noCapital = { ...cfg, regions: ['50', '16'] };
    expect(generatePlate('mythic', createSeededRng(1), noCapital)).toBeNull();
  });

  it('легендарка без VIP-серий всё ещё достижима', () => {
    const noVip = { ...cfg, rarity: { ...cfg.rarity, vipSeries: [] } };
    const plate = generatePlate('legendary', createSeededRng(3), noVip);
    expect(classifyPlate(plate!, noVip.rarity).traits).toContain('same_letters_same_digits');
  });
});

describe('rollTier', () => {
  it('частоты близки к заданным шансам', () => {
    const odds = { common: 50, uncommon: 30, rare: 15, epic: 4, legendary: 1, mythic: 0 };
    const total = 100;
    const n = 200_000;
    const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<string, number>;
    const rng = createSeededRng(123);
    for (let i = 0; i < n; i++) counts[rollTier(odds, rng)]!++;
    for (const t of TIERS) {
      expect(counts[t]! / n).toBeCloseTo(odds[t] / total, 2);
    }
    expect(counts.mythic).toBe(0);
  });

  it('падает на нулевых весах', () => {
    const zero = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
    expect(() => rollTier(zero, createSeededRng(1))).toThrow();
  });
});

describe('rollUniquePlate', () => {
  const onlyMythic = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 1 };

  it('не выдаёт уже занятые номера', async () => {
    const taken = new Set<string>();
    const rng = createSeededRng(99);
    for (let i = 0; i < 300; i++) {
      const res = await rollUniquePlate({
        odds: DEFAULT_GAME_CONFIG.odds,
        rng,
        config: cfg,
        tryClaim: async (p) => {
          const key = plateKey(p);
          if (taken.has(key)) return false;
          taken.add(key);
          return true;
        },
      });
      expect(res).not.toBeNull();
    }
    expect(taken.size).toBe(300);
  });

  it('спускается на тир ниже, когда свободных номеров тира нет', async () => {
    const res = await rollUniquePlate({
      odds: onlyMythic,
      rng: createSeededRng(5),
      config: cfg,
      tryClaim: async (_p: Plate, rarity) => rarity.tier !== 'mythic',
    });
    expect(res!.rolledTier).toBe('mythic');
    expect(res!.rarity.tier).toBe('legendary');
  });

  it('возвращает null, если свободных номеров нет вовсе', async () => {
    const res = await rollUniquePlate({
      odds: onlyMythic,
      rng: createSeededRng(5),
      config: cfg,
      tryClaim: async () => false,
      attemptsPerTier: 3,
    });
    expect(res).toBeNull();
  });
});
