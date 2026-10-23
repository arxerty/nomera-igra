import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  canMatch,
  createSeededRng,
  isValidRaceBet,
  matchmakingGap,
  raceBetSettlement,
  raceRating,
  racesLeftToday,
  resolveRace,
} from '../src';

const cfg = DEFAULT_GAME_CONFIG.races;
const strong = { speed: 90, acceleration: 90, handling: 85 };
const weak = { speed: 50, acceleration: 40, handling: 45 };
const near = { speed: 88, acceleration: 89, handling: 86 };
const mid = { speed: 72, acceleration: 68, handling: 70 };

describe('рейтинг и подбор соперника', () => {
  it('рейтинг — взвешенная сумма', () => {
    expect(raceRating({ speed: 100, acceleration: 100, handling: 100 }, cfg)).toBeCloseTo(100, 9);
  });

  it('окно подбора расширяется с ожиданием до максимума', () => {
    expect(matchmakingGap(0, cfg)).toBe(cfg.matchmaking.baseGap);
    expect(matchmakingGap(30, cfg)).toBe(cfg.matchmaking.baseGap + 2 * cfg.matchmaking.gapPer15s);
    expect(matchmakingGap(100_000, cfg)).toBe(cfg.matchmaking.maxGap);
  });

  it('близкие по рейтингу сводятся сразу, далёкие — только после ожидания', () => {
    const a = raceRating(strong, cfg);
    expect(canMatch(a, raceRating(near, cfg), 0, cfg)).toBe(true);
    const b = raceRating(mid, cfg);
    expect(canMatch(a, b, 0, cfg)).toBe(false);
    expect(canMatch(a, b, 600, cfg)).toBe(true);
  });

  it('совсем разные машины не сводятся никогда', () => {
    expect(canMatch(raceRating(strong, cfg), raceRating(weak, cfg), 100_000, cfg)).toBe(false);
  });
});

describe('resolveRace', () => {
  it('сильная машина почти всегда обгоняет слабую', () => {
    const rng = createSeededRng(3);
    let wins = 0;
    for (let i = 0; i < 2_000; i++) if (resolveRace(strong, weak, rng, cfg).winner === 'a') wins++;
    expect(wins).toBe(2_000);
  });

  it('у близких машин исход не предрешён', () => {
    const rng = createSeededRng(4);
    let wins = 0;
    const n = 4_000;
    for (let i = 0; i < n; i++) if (resolveRace(strong, near, rng, cfg).winner === 'a') wins++;
    expect(wins / n).toBeGreaterThan(0.5);
    expect(wins / n).toBeLessThan(0.85);
  });

  it('у победителя время всегда меньше', () => {
    const rng = createSeededRng(5);
    for (let i = 0; i < 2_000; i++) {
      const r = resolveRace(strong, strong, rng, cfg);
      if (r.winner === 'a') expect(r.timeA).toBeLessThan(r.timeB);
      else expect(r.timeB).toBeLessThan(r.timeA);
    }
  });

  it('один и тот же сид — один и тот же исход', () => {
    expect(resolveRace(strong, near, createSeededRng(9), cfg)).toEqual(resolveRace(strong, near, createSeededRng(9), cfg));
  });
});

describe('ставки и лимит', () => {
  it('ставка 0 или в пределах', () => {
    expect(isValidRaceBet(0, cfg)).toBe(true);
    expect(isValidRaceBet(cfg.minBet, cfg)).toBe(true);
    expect(isValidRaceBet(cfg.minBet - 1, cfg)).toBe(false);
    expect(isValidRaceBet(cfg.maxBet + 1, cfg)).toBe(false);
    expect(isValidRaceBet(10.5, cfg)).toBe(false);
  });

  it('победитель забирает банк минус комиссия', () => {
    expect(raceBetSettlement(100, 5)).toEqual({ pot: 200, fee: 10, winnerReceives: 190 });
    expect(raceBetSettlement(0, 5)).toEqual({ pot: 0, fee: 0, winnerReceives: 0 });
  });

  it('лимит гонок в сутки', () => {
    expect(racesLeftToday(0, cfg)).toBe(cfg.dailyLimit);
    expect(racesLeftToday(cfg.dailyLimit + 3, cfg)).toBe(0);
  });
});
