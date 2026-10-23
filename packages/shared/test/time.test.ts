import { describe, expect, it } from 'vitest';
import {
  gameDayKey,
  gameWeekKey,
  gameWeekStart,
  isFreeRollReady,
  nextFreeRollAt,
  nextGameDayStart,
  previousDayKey,
} from '../src';

describe('игровые сутки', () => {
  it('сутки по Москве начинаются в 21:00 UTC', () => {
    expect(gameDayKey(new Date('2026-10-20T20:59:59Z'), 3)).toBe('2026-10-20');
    expect(gameDayKey(new Date('2026-10-20T21:00:00Z'), 3)).toBe('2026-10-21');
  });

  it('previousDayKey переходит через месяц и год', () => {
    expect(previousDayKey('2026-03-01')).toBe('2026-02-28');
    expect(previousDayKey('2027-01-01')).toBe('2026-12-31');
  });

  it('nextGameDayStart', () => {
    expect(nextGameDayStart(new Date('2026-10-20T10:00:00Z'), 3).toISOString()).toBe(
      '2026-10-20T21:00:00.000Z',
    );
  });
});

describe('gameWeekKey', () => {
  it('ISO-недели', () => {
    expect(gameWeekKey(new Date('2026-10-20T12:00:00Z'), 0)).toBe('2026-W43');
    // 1 января 2027 — пятница, относится к 53-й неделе 2026
    expect(gameWeekKey(new Date('2027-01-01T12:00:00Z'), 0)).toBe('2026-W53');
    expect(gameWeekKey(new Date('2027-01-04T12:00:00Z'), 0)).toBe('2027-W01');
  });

  it('gameWeekStart — понедельник 00:00 игрового времени', () => {
    expect(gameWeekStart(new Date('2026-10-20T12:00:00Z'), 3).toISOString()).toBe('2026-10-18T21:00:00.000Z');
    expect(gameWeekStart(new Date('2026-10-25T22:00:00Z'), 3).toISOString()).toBe('2026-10-25T21:00:00.000Z');
    expect(gameWeekStart(new Date('2026-10-19T00:00:00Z'), 0).toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('учитывает смещение: вс 22:00 UTC — уже понедельник по Москве', () => {
    expect(gameWeekKey(new Date('2026-10-25T22:00:00Z'), 0)).toBe('2026-W43');
    expect(gameWeekKey(new Date('2026-10-25T22:00:00Z'), 3)).toBe('2026-W44');
  });
});

describe('бесплатная попытка', () => {
  const last = new Date('2026-10-20T10:00:00Z');

  it('доступна, если ещё не использовалась', () => {
    expect(nextFreeRollAt(null, 4)).toBeNull();
    expect(isFreeRollReady(null, 4, last)).toBe(true);
  });

  it('доступна через интервал', () => {
    expect(nextFreeRollAt(last, 4)!.toISOString()).toBe('2026-10-20T14:00:00.000Z');
    expect(isFreeRollReady(last, 4, new Date('2026-10-20T13:59:59Z'))).toBe(false);
    expect(isFreeRollReady(last, 4, new Date('2026-10-20T14:00:00Z'))).toBe(true);
  });
});
