import type { Plate, User } from '@prisma/client';
import type { BonusId, Locale, PlateDto, SettingsDto, TraitId, UserPublicDto } from '@nomer/shared';
import type { PlateWithListing } from './db';

type PublicUserFields = Pick<User, 'id' | 'firstName' | 'lastName' | 'username' | 'photoUrl'>;

export function userPublic(u: PublicUserFields): UserPublicDto {
  return {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' '),
    username: u.username,
    photoUrl: u.photoUrl,
  };
}

export const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  photoUrl: true,
} as const;

export function plateDto(p: Plate | PlateWithListing): PlateDto {
  const listing = 'listings' in p ? (p.listings[0] ?? null) : null;
  const carId = 'car' in p ? (p.car?.id ?? null) : null;
  return {
    id: p.id,
    key: p.key,
    letters: p.letters,
    number: p.number,
    region: p.region,
    tier: p.tier,
    traits: p.traits as TraitId[],
    bonuses: p.bonuses as BonusId[],
    value: p.value,
    acquiredAt: p.acquiredAt?.toISOString() ?? null,
    listing,
    carId,
  };
}

export function settingsDto(u: User): SettingsDto {
  return {
    locale: u.locale as Locale,
    soundEnabled: u.soundEnabled,
    hapticsEnabled: u.hapticsEnabled,
    notificationsEnabled: u.notificationsEnabled,
  };
}

export function localeFromLanguageCode(code: string | undefined): Locale {
  return code && ['ru', 'uk', 'be', 'kk'].includes(code.slice(0, 2)) ? 'ru' : 'en';
}
