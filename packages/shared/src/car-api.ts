/** DTO машин и связанных режимов. Даты — ISO-строки. */
import type { AchievementId } from './achievements';
import type { PlateDto, UserPublicDto } from './api';
import type { CarArchetype, CarClass, CarStats, CarTuning, ShowroomMode } from './cars';
import type { ComboId } from './combos';
import type { GameConfig } from './config';

/** Публичные настройки машинных режимов: клиенту нужны палитра, цены тюнинга, длительности, ставки. */
export type CarsConfigDto = Pick<GameConfig, 'cars' | 'races' | 'auction' | 'exhibition' | 'clubs' | 'dreamSearch'>;

export interface CarModelDto {
  id: string;
  brand: string;
  name: string;
  year: number;
  class: CarClass;
  archetype: CarArchetype;
  stats: CarStats;
  priceChips: number;
  priceStars: number | null;
  showroom: ShowroomMode;
  editionSize: number | null;
  /** Сколько экземпляров тиража осталось; null — тираж не ограничен. */
  editionLeft: number | null;
  season: string | null;
  styleNumbers: number[];
}

export interface GarageSlotsDto {
  used: number;
  slots: number;
  maxSlots: number;
  /** Цена следующего места; null — достигнут максимум. */
  nextSlot: { chips: number; stars: number } | null;
}

export interface ShowroomDto {
  dayKey: string;
  /** Когда сменится ротация. */
  rotatesAt: string;
  models: CarModelDto[];
  garage: GarageSlotsDto;
}

/** Чем занята машина: пока занята, её нельзя продать, перевесить номер или выставить на гонку. */
export type CarBusy = 'trip' | 'listed' | 'race_queue';

export interface TripEventDto {
  id: string;
  title: string;
  /** Прибавка или штраф (со знаком минус) к доходу. */
  delta: number;
}

export interface TripDto {
  id: string;
  carId: string;
  hours: number;
  startedAt: string;
  endsAt: string;
  /** Машина уже вернулась. */
  finished: boolean;
  collected: boolean;
  /** Доход без события — известен сразу. */
  baseIncome: number;
  /** Итог с событием — раскрывается, когда машина вернулась. */
  income: number | null;
  event: TripEventDto | null;
}

export interface CarDto {
  id: string;
  ownerId: string | null;
  model: CarModelDto;
  /** Номер экземпляра тиража (№ 17 из 100) у коллекционных машин. */
  serial: number | null;
  tuning: CarTuning;
  plate: PlateDto | null;
  combos: ComboId[];
  multipliers: { income: number; prestige: number };
  /** Характеристики с тюнингом (без комбо). */
  stats: CarStats;
  /** Престиж с тюнингом и комбо. */
  prestige: number;
  /** Стоимость в рейтинге коллекций. */
  value: number;
  raceRating: number;
  /** Сколько Фишек в час машина принесёт на покатушках (без события). */
  tripHourlyIncome: number;
  busy: CarBusy | null;
  trip: TripDto | null;
  listing: { id: string; price: number; withPlate: boolean } | null;
  /** Когда можно сменить номер; null — можно сейчас. */
  plateChangeAt: string | null;
  /** Бейджи: "exhibition:2026-W43:2" — 2-е место выставки, "mesalliance". */
  badges: string[];
  acquiredAt: string;
}

export interface CarGarageDto {
  cars: CarDto[];
  garage: GarageSlotsDto;
  unlockedPaints: string[];
  totalValue: number;
}

export type CarAcquireVia = 'showroom' | 'market';

export interface CarHistoryEntryDto {
  owner: UserPublicDto;
  acquiredAt: string;
  acquiredVia: CarAcquireVia;
  acquiredPrice: number | null;
  releasedAt: string | null;
}

export interface CarCardDto {
  car: CarDto;
  owner: UserPublicDto | null;
  /** История владельцев, от новых к старым. */
  history: CarHistoryEntryDto[];
  /** Самая дорогая сделка с машиной. */
  recordPrice: number | null;
}

export interface CarListingDto {
  id: string;
  price: number;
  withPlate: boolean;
  createdAt: string;
  seller: UserPublicDto;
  car: CarDto;
  isMine: boolean;
}

export interface RacerDto {
  /** null — «призрак» (соперник не нашёлся). */
  user: UserPublicDto | null;
  modelId: string;
  title: string;
  carClass: CarClass;
  tuning: CarTuning;
  plate: PlateDto | null;
  rating: number;
  timeMs: number;
}

export interface RaceDto {
  id: string;
  createdAt: string;
  me: RacerDto;
  opponent: RacerDto;
  won: boolean;
  bet: number;
  /** Сколько Фишек получено (у победителя — банк за вычетом комиссии). */
  payout: number;
}

export interface RaceQueueDto {
  status: 'idle' | 'waiting';
  entry: { carId: string; bet: number; since: string; gap: number } | null;
  /** Последний заезд — клиент показывает анимацию, если он новее предыдущего. */
  lastRace: RaceDto | null;
  racesLeft: number;
}

export interface AuctionBidDto {
  user: UserPublicDto;
  amount: number;
  at: string;
}

export interface AuctionDto {
  id: string;
  plate: PlateDto;
  status: 'active' | 'settled' | 'unsold';
  startPrice: number;
  currentBid: number | null;
  minNextBid: number;
  leader: UserPublicDto | null;
  isLeader: boolean;
  endsAt: string;
  bids: AuctionBidDto[];
}

export interface ExhibitionEntryDto {
  id: string;
  owner: UserPublicDto;
  car: CarDto;
  wins: number;
  shows: number;
  score: number;
  place: number | null;
}

export interface ExhibitionDto {
  weekKey: string;
  endsAt: string;
  myEntry: ExhibitionEntryDto | null;
  canVote: boolean;
  rewardedVotesLeft: number;
  top: ExhibitionEntryDto[];
  /** Итоги прошлой недели. */
  previousTop: ExhibitionEntryDto[];
}

export interface VotePairDto {
  pair: [ExhibitionEntryDto, ExhibitionEntryDto] | null;
}

export interface ClubMemberDto {
  user: UserPublicDto;
  role: 'owner' | 'member';
  value: number;
  joinedAt: string;
}

export interface ClubDto {
  id: string;
  name: string;
  chatLink: string | null;
  rating: number;
  rank: number | null;
  members: ClubMemberDto[];
  maxMembers: number;
  isMember: boolean;
}

export interface ClubListItemDto {
  id: string;
  name: string;
  memberCount: number;
  rating: number;
  rank: number;
}

export interface DreamMaskDto {
  id: string;
  mask: string;
  createdAt: string;
}

export interface AchievementDto {
  id: AchievementId;
  earnedAt: string | null;
}

export interface AchievementsDto {
  achievements: AchievementDto[];
  title: AchievementId | null;
}
