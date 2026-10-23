import type { ClubsConfig } from './car-config';

export function isValidClubName(name: string, cfg: ClubsConfig): boolean {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return (
    trimmed === name &&
    length >= cfg.nameMinLength &&
    length <= cfg.nameMaxLength &&
    /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(trimmed)
  );
}

/** Ссылка на общий чат клуба: только t.me, публичный канал/группа или инвайт. */
export function isValidClubChatLink(url: string): boolean {
  return /^https:\/\/t\.me\/(\+[\w-]{8,}|joinchat\/[\w-]{8,}|[A-Za-z][\w]{4,31})$/.test(url);
}

export function canJoinClub(memberCount: number, cfg: ClubsConfig): boolean {
  return memberCount < cfg.maxMembers;
}

/** Рейтинг клуба — суммарная стоимость коллекций участников. */
export function clubRating(memberCollectionValues: readonly number[]): number {
  return memberCollectionValues.reduce((s, v) => s + v, 0);
}
