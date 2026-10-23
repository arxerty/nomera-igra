const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Ключ игровых суток "YYYY-MM-DD" со смещением от UTC (3 — по Москве). */
export function gameDayKey(at: Date, offsetHours: number): string {
  return new Date(at.getTime() + offsetHours * HOUR).toISOString().slice(0, 10);
}

/** Ключ предыдущих игровых суток относительно ключа "YYYY-MM-DD". */
export function previousDayKey(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
}

/** Начало следующих игровых суток (момент сброса заданий и ежедневного бонуса). */
export function nextGameDayStart(at: Date, offsetHours: number): Date {
  const key = gameDayKey(at, offsetHours);
  return new Date(Date.parse(`${key}T00:00:00Z`) + DAY - offsetHours * HOUR);
}

/** ISO-неделя игрового времени: "2026-W43". */
export function gameWeekKey(at: Date, offsetHours: number): string {
  const local = new Date(Date.parse(`${gameDayKey(at, offsetHours)}T00:00:00Z`));
  const weekday = local.getUTCDay() || 7; // пн = 1 … вс = 7
  local.setUTCDate(local.getUTCDate() + 4 - weekday); // четверг этой недели
  const year = local.getUTCFullYear();
  const week = Math.ceil(((local.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Начало игровой недели (понедельник 00:00 игрового времени), в которую попадает `at`. */
export function gameWeekStart(at: Date, offsetHours: number): Date {
  const localMidnight = Date.parse(`${gameDayKey(at, offsetHours)}T00:00:00Z`);
  const weekday = new Date(localMidnight).getUTCDay() || 7;
  return new Date(localMidnight - (weekday - 1) * DAY - offsetHours * HOUR);
}

/** Ключ сезона — игровой месяц: "2026-10". */
export function gameSeasonKey(at: Date, offsetHours: number): string {
  return gameDayKey(at, offsetHours).slice(0, 7);
}

/** Начало текущего сезона (1-е число игрового месяца, 00:00 игрового времени). */
export function gameSeasonStart(at: Date, offsetHours: number): Date {
  const [year, month] = gameSeasonKey(at, offsetHours).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1) - offsetHours * HOUR);
}

/** Начало следующего сезона (1-е число следующего игрового месяца, 00:00 игрового времени). */
export function nextGameSeasonStart(at: Date, offsetHours: number): Date {
  const [year, month] = gameSeasonKey(at, offsetHours).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 1) - offsetHours * HOUR);
}

/** Момент, когда станет доступна бесплатная попытка; null — доступна сейчас (ещё не использовалась). */
export function nextFreeRollAt(lastFreeRollAt: Date | null, intervalHours: number): Date | null {
  return lastFreeRollAt ? new Date(lastFreeRollAt.getTime() + intervalHours * HOUR) : null;
}

export function isFreeRollReady(lastFreeRollAt: Date | null, intervalHours: number, now: Date): boolean {
  const at = nextFreeRollAt(lastFreeRollAt, intervalHours);
  return at === null || at.getTime() <= now.getTime();
}
