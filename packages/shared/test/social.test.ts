import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_NAMES,
  DEFAULT_GAME_CONFIG,
  canJoinClub,
  canVoteInExhibition,
  createSeededRng,
  earnedAchievements,
  exhibitionPrize,
  exhibitionScore,
  gameSeasonKey,
  gameSeasonStart,
  isAcceptableDreamMask,
  isValidClubChatLink,
  isValidClubName,
  maskFixedChars,
  nextGameSeasonStart,
  nextQuestProgress,
  parseMask,
  pickVotePair,
  rankExhibition,
  type AchievementStats,
  type QuestConfig,
} from '../src';

const { exhibition, clubs, dreamSearch, quests } = DEFAULT_GAME_CONFIG;
const quest = (id: string): QuestConfig => quests.find((q) => q.id === id)!;

describe('автовыставка', () => {
  const now = new Date('2026-10-22T12:00:00Z');

  it('голосуют только «взрослые» аккаунты с прогрессом', () => {
    const old = new Date('2026-10-01T00:00:00Z');
    expect(canVoteInExhibition({ createdAt: old, rollsTotal: 50 }, now, exhibition)).toBe(true);
    expect(canVoteInExhibition({ createdAt: new Date('2026-10-21T00:00:00Z'), rollsTotal: 50 }, now, exhibition)).toBe(false);
    expect(canVoteInExhibition({ createdAt: old, rollsTotal: 1 }, now, exhibition)).toBe(false);
  });

  it('оценка Уилсона: 90 из 100 выше, чем 3 из 3', () => {
    expect(exhibitionScore(90, 100)).toBeGreaterThan(exhibitionScore(3, 3));
    expect(exhibitionScore(0, 0)).toBe(0);
  });

  it('таблица: машины с малым числом показов без мест', () => {
    const table = rankExhibition(
      [
        { id: 'a', wins: 15, shows: 20 },
        { id: 'b', wins: 5, shows: 5 },
        { id: 'c', wins: 30, shows: 35 },
      ],
      exhibition,
    );
    expect(table.map((e) => [e.id, e.place])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', null],
    ]);
    expect(exhibitionPrize(1, exhibition)).toEqual(exhibition.prizes[0]);
    expect(exhibitionPrize(null, exhibition)).toBeNull();
    expect(exhibitionPrize(11, exhibition)).toBeNull();
  });

  it('пара для голосования — две разные чужие машины, показы выравниваются', () => {
    const rng = createSeededRng(21);
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, wins: 0, shows: 0 }));
    for (let i = 0; i < 3_000; i++) {
      const pair = pickVotePair(entries, new Set(['e0']), rng)!;
      expect(pair[0]).not.toBe(pair[1]);
      expect(pair).not.toContain('e0');
      for (const id of pair) entries.find((e) => e.id === id)!.shows++;
    }
    const shows = entries.slice(1).map((e) => e.shows);
    expect(Math.max(...shows) - Math.min(...shows)).toBeLessThan(60);
    expect(pickVotePair(entries.slice(0, 2), new Set(['e0']), rng)).toBeNull();
  });
});

describe('клубы', () => {
  it('название клуба', () => {
    expect(isValidClubName('Блатные 777', clubs)).toBe(true);
    expect(isValidClubName('ab', clubs)).toBe(false);
    expect(isValidClubName(' Пробел', clubs)).toBe(false);
    expect(isValidClubName('<script>', clubs)).toBe(false);
  });

  it('ссылка на чат — только t.me', () => {
    expect(isValidClubChatLink('https://t.me/nomera_club')).toBe(true);
    expect(isValidClubChatLink('https://t.me/+AbCdEfGh123')).toBe(true);
    expect(isValidClubChatLink('https://evil.example/t.me/x')).toBe(false);
    expect(isValidClubChatLink('http://t.me/nomera_club')).toBe(false);
  });

  it('лимит участников', () => {
    expect(canJoinClub(clubs.maxMembers - 1, clubs)).toBe(true);
    expect(canJoinClub(clubs.maxMembers, clubs)).toBe(false);
  });
});

describe('номер мечты', () => {
  it('маска должна быть достаточно конкретной', () => {
    expect(maskFixedChars(parseMask('*777** 77')!)).toBe(5);
    expect(isAcceptableDreamMask(parseMask('*777**')!, dreamSearch)).toBe(true);
    expect(isAcceptableDreamMask(parseMask('******')!, dreamSearch)).toBe(false);
    expect(isAcceptableDreamMask(parseMask('*7****')!, dreamSearch)).toBe(false);
  });
});

describe('сезоны', () => {
  it('сезон — игровой месяц со смещением по Москве', () => {
    expect(gameSeasonKey(new Date('2026-10-31T20:59:59Z'), 3)).toBe('2026-10');
    expect(gameSeasonKey(new Date('2026-10-31T21:00:00Z'), 3)).toBe('2026-11');
    expect(nextGameSeasonStart(new Date('2026-10-15T00:00:00Z'), 3).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(nextGameSeasonStart(new Date('2026-12-15T00:00:00Z'), 3).toISOString()).toBe('2026-12-31T21:00:00.000Z');
    expect(gameSeasonStart(new Date('2026-10-15T00:00:00Z'), 3).toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(gameSeasonStart(new Date('2026-10-31T21:00:00Z'), 3).toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });
});

describe('ачивки', () => {
  const none: AchievementStats = {
    platesOwned: 0,
    carsOwned: 0,
    raceWins: 0,
    ownsTripleSeven: false,
    hadMesalliance: false,
    maxSeries: 0,
    exhibitionTop10: 0,
    auctionsWon: 0,
  };

  it('выдаются по сводке', () => {
    expect(earnedAchievements(none)).toEqual([]);
    expect(earnedAchievements({ ...none, ownsTripleSeven: true, raceWins: 100 })).toEqual(['track_king', 'three_sevens']);
  });

  it('у каждой ачивки есть название на обоих языках', () => {
    for (const id of ACHIEVEMENT_IDS) {
      expect(ACHIEVEMENT_NAMES.ru[id].title).toBeTruthy();
      expect(ACHIEVEMENT_NAMES.en[id].title).toBeTruthy();
    }
  });
});

describe('задания с машинами', () => {
  it('«Повесь Редкий+ на Бизнес+» учитывает и тир, и класс', () => {
    const q = quest('mount_rare_business');
    expect(nextQuestProgress(q, 0, 'plate_mount', { tier: 'rare', carClass: 'business' })).toBe(1);
    expect(nextQuestProgress(q, 0, 'plate_mount', { tier: 'mythic', carClass: 'luxury' })).toBe(1);
    expect(nextQuestProgress(q, 0, 'plate_mount', { tier: 'uncommon', carClass: 'luxury' })).toBeNull();
    expect(nextQuestProgress(q, 0, 'plate_mount', { tier: 'rare', carClass: 'comfort' })).toBeNull();
    expect(nextQuestProgress(q, 0, 'trip_start', { tier: 'rare', carClass: 'business' })).toBeNull();
  });

  it('«Покатушки» считаются по штукам до цели', () => {
    const q = quest('trip_3');
    expect(nextQuestProgress(q, 2, 'trip_start')).toBe(3);
    expect(nextQuestProgress(q, 3, 'trip_start')).toBeNull();
  });

  it('«Две победы подряд»: поражение сбрасывает серию', () => {
    const q = quest('race_win_streak_2');
    expect(nextQuestProgress(q, 0, 'race_win')).toBe(1);
    expect(nextQuestProgress(q, 1, 'race_loss')).toBe(0);
    expect(nextQuestProgress(q, 0, 'race_loss')).toBeNull();
    expect(nextQuestProgress(q, 1, 'race_win')).toBe(2);
    // Выполненное задание поражением не отнимается.
    expect(nextQuestProgress(q, 2, 'race_loss')).toBeNull();
  });

  it('«Серия из трёх»: прогресс — наибольшая серия', () => {
    const q = quest('series_3');
    expect(nextQuestProgress(q, 0, 'series_size', { value: 2 })).toBe(2);
    expect(nextQuestProgress(q, 2, 'series_size', { value: 1 })).toBeNull();
    expect(nextQuestProgress(q, 2, 'series_size', { value: 5 })).toBe(3);
  });

  it('старые задания работают как раньше', () => {
    const q = quest('roll_rare');
    expect(nextQuestProgress(q, 0, 'roll', { tier: 'epic' })).toBe(1);
    expect(nextQuestProgress(q, 0, 'roll', { tier: 'common' })).toBeNull();
  });
});
