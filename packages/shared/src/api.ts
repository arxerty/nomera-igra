/** DTO, которыми обмениваются API, Mini App и бот. Даты — ISO-строки, Telegram ID — строки. */
import type { BonusId, Tier, TraitId, VipSeries } from './rarity';
import type { Locale } from './tier-meta';

export interface PlateDto {
  id: string;
  key: string;
  letters: string;
  number: number;
  region: string;
  tier: Tier;
  traits: TraitId[];
  bonuses: BonusId[];
  value: number;
  acquiredAt: string | null;
  listing: { id: string; price: number } | null;
  /** Машина, на которой висит номер. */
  carId: string | null;
}

export interface UserPublicDto {
  id: string;
  name: string;
  username: string | null;
  photoUrl: string | null;
}

export interface SettingsDto {
  locale: Locale;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
}

export interface DailyStatusDto {
  streak: number;
  canClaim: boolean;
  /** Награда, которую игрок получит при следующем получении бонуса. */
  nextReward: { rolls: number; chips: number };
  resetsAt: string;
}

export interface BalanceDto {
  chips: number;
  rolls: number;
}

export interface MeDto extends BalanceDto {
  user: UserPublicDto & { telegramId: string; isAdmin: boolean };
  /** Когда станет доступна бесплатная попытка; null — доступна сейчас. */
  freeRollAt: string | null;
  serverTime: string;
  lastPlate: PlateDto | null;
  daily: DailyStatusDto;
  settings: SettingsDto;
  economy: {
    rollCostChips: number;
    freeRollIntervalHours: number;
    marketFeePercent: number;
    minListingPrice: number;
    maxListingPrice: number;
  };
  starPacks: { id: string; rolls: number; stars: number }[];
}

export type RollSource = 'free' | 'balance';

export interface RollResultDto extends BalanceDto {
  plate: PlateDto;
  /** Тир, выпавший по шансам; может быть выше итогового, если тир исчерпан. */
  rolledTier: Tier;
  source: RollSource;
  freeRollAt: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface GarageSummaryDto {
  total: number;
  value: number;
  byTier: Record<Tier, number>;
  regions: string[];
}

export type AcquireVia = 'roll' | 'market' | 'trade' | 'auction';

export interface PassportEntryDto {
  owner: UserPublicDto;
  acquiredAt: string;
  acquiredVia: AcquireVia;
  acquiredPrice: number | null;
  releasedAt: string | null;
}

export interface PlateCardDto {
  plate: PlateDto;
  owner: UserPublicDto | null;
  firstRolledAt: string;
  rolledTimes: number;
  /** История владельцев, от новых к старым. */
  passport: PassportEntryDto[];
  /** Самая дорогая сделка с номером. */
  recordPrice: number | null;
}

export interface ListingDto {
  id: string;
  price: number;
  createdAt: string;
  seller: UserPublicDto;
  plate: PlateDto;
  isMine: boolean;
}

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface TradeOfferDto {
  code: string;
  status: TradeStatus;
  from: UserPublicDto;
  to: UserPublicDto | null;
  offered: PlateDto[];
  requested: PlateDto[];
  offeredChips: number;
  requestedChips: number;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  link: string;
  /** Может ли текущий пользователь принять предложение. */
  canAccept: boolean;
}

/** value — коллекция (номера + машины), weekly — выбитое за неделю, season — за сезон (месяц), races — победы в недельном турнире. */
export const LEADERBOARDS = ['value', 'legendary', 'weekly', 'season', 'races'] as const;
export type LeaderboardBoard = (typeof LEADERBOARDS)[number];

export interface LeaderboardEntryDto {
  rank: number;
  user: UserPublicDto;
  score: number;
}

export interface LeaderboardDto {
  board: LeaderboardBoard;
  entries: LeaderboardEntryDto[];
  /** Своё место; rank = null, если игрок ещё не в рейтинге. */
  me: { rank: number | null; score: number };
}

export interface QuestDto {
  id: string;
  title: string;
  target: number;
  progress: number;
  rewardChips: number;
  rewardRolls: number;
  claimed: boolean;
}

export interface QuestsDto {
  quests: QuestDto[];
  daily: DailyStatusDto;
}

export interface OddsDto {
  tiers: { tier: Tier; percent: number; price: number }[];
  bonusMultipliers: Record<BonusId, number>;
  vipSeries: VipSeries[];
  mythicNumbers: number[];
  capitalRegions: string[];
}

export interface ProfileDto {
  user: UserPublicDto;
  memberSince: string;
  stats: {
    totalRolls: number;
    platesOwned: number;
    collectionValue: number;
    byTier: Record<Tier, number>;
    bestPlate: PlateDto | null;
    referrals: number;
  };
  ranks: Record<LeaderboardBoard, number | null>;
  referralLink: string;
  settings: SettingsDto;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'no_rolls'
  | 'insufficient_funds'
  | 'pool_exhausted'
  | 'not_owner'
  | 'plate_listed'
  | 'listing_closed'
  | 'own_listing'
  | 'already_claimed'
  | 'quest_incomplete'
  | 'trade_closed'
  | 'trade_invalid'
  | 'payment_invalid'
  | 'garage_full'
  | 'car_busy'
  | 'plate_mounted'
  | 'plate_change_cooldown'
  | 'no_plate'
  | 'sold_out'
  | 'not_in_showroom'
  | 'tuning_invalid'
  | 'race_limit'
  | 'already_in_queue'
  | 'auction_closed'
  | 'bid_too_low'
  | 'already_leading'
  | 'vote_not_allowed'
  | 'club_full'
  | 'already_in_club'
  | 'name_taken'
  | 'limit_reached'
  | 'internal';

export interface ApiErrorDto {
  error: { code: ApiErrorCode; message: string };
}
