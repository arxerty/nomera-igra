import { useEffect, useState } from 'react';
import type { Locale } from '@nomer/shared';

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n);
}

export function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Обратный отсчёт до момента `target`; учитывает расхождение часов клиента и сервера. */
export function useCountdown(target: string | null, serverOffsetMs = 0): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Date.parse(target) - (now + serverOffsetMs));
}

export function rewardText(r: { chips: number; rolls: number }, locale: Locale): string {
  const parts: string[] = [];
  if (r.chips) parts.push(`${formatNumber(r.chips)} ${locale === 'ru' ? 'Фишек' : 'chips'}`);
  if (r.rolls) parts.push(`${r.rolls} ${locale === 'ru' ? 'попыт.' : r.rolls === 1 ? 'roll' : 'rolls'}`);
  return parts.join(' + ');
}
