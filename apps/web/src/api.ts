import type {
  AchievementId,
  AchievementsDto,
  ApiErrorCode,
  AuctionDto,
  BalanceDto,
  CarCardDto,
  CarClass,
  CarDto,
  CarGarageDto,
  CarListingDto,
  CarsConfigDto,
  CarTuning,
  ClubDto,
  ClubListItemDto,
  DreamMaskDto,
  ExhibitionDto,
  GarageSlotsDto,
  PaintFinish,
  RaceDto,
  RaceQueueDto,
  ShowroomDto,
  VotePairDto,
  DailyStatusDto,
  GarageSummaryDto,
  LeaderboardBoard,
  LeaderboardDto,
  ListingDto,
  MeDto,
  OddsDto,
  Page,
  PlateCardDto,
  PlateDto,
  ProfileDto,
  QuestsDto,
  RollResultDto,
  SettingsDto,
  Tier,
  TradeOfferDto,
} from '@nomer/shared';
import { tg } from './telegram';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const DEV_TELEGRAM_ID = import.meta.env.VITE_DEV_TELEGRAM_ID as string | undefined;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function authHeader(): string {
  if (tg?.initData) return `tma ${tg.initData}`;
  if (DEV_TELEGRAM_ID) return `dev ${DEV_TELEGRAM_ID}`;
  return '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: authHeader() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'internal', 'Нет связи с сервером');
  }
  const json = (await res.json().catch(() => null)) as { error?: { code: ApiErrorCode; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? 'internal', json?.error?.message ?? `Ошибка ${res.status}`);
  }
  return json as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}

export type GarageSort = 'newest' | 'oldest' | 'value_desc' | 'value_asc' | 'tier_desc';
export type MarketSort = 'newest' | 'price_asc' | 'price_desc' | 'value_desc';

export interface GarageFilters {
  tier?: Tier;
  region?: string;
  sort: GarageSort;
}

export interface MarketFilters {
  mask?: string;
  region?: string;
  tier?: Tier;
  sellerId?: string;
  sort: MarketSort;
}

export type CarMarketSort = 'newest' | 'price_asc' | 'price_desc';

export interface CarMarketFilters {
  carClass?: CarClass;
  withPlate?: boolean;
  sort: CarMarketSort;
}

export type ItemInvoice =
  | { kind: 'car'; modelId: string; color?: string }
  | { kind: 'paint'; carId: string; finish: PaintFinish; color: string }
  | { kind: 'garage_slot' };

export const api = {
  auth: () => request<MeDto>('POST', '/auth'),
  me: () => request<MeDto>('GET', '/me'),
  odds: () => request<OddsDto>('GET', '/odds'),

  roll: () => request<RollResultDto>('POST', '/roll'),
  buyRolls: (count: number) => request<BalanceDto>('POST', '/rolls/buy', { count }),
  invoice: (packId: string) => request<{ link: string; paymentId: string }>('POST', '/payments/invoice', { packId }),

  garage: (f: GarageFilters, cursor?: string | null, userId?: string) =>
    request<Page<PlateDto>>('GET', `${userId ? `/users/${userId}` : ''}/garage${qs({ ...f, cursor })}`),
  garageSummary: () => request<GarageSummaryDto>('GET', '/garage/summary'),
  plate: (idOrKey: string) => request<PlateCardDto>('GET', `/plates/${encodeURIComponent(idOrKey)}`),
  sellPlate: (id: string) => request<{ chips: number; received: number }>('POST', `/plates/${id}/sell`),

  market: (f: MarketFilters, cursor?: string | null) => request<Page<ListingDto>>('GET', `/market${qs({ ...f, cursor })}`),
  createListing: (plateId: string, price: number) => request<ListingDto>('POST', '/market/listings', { plateId, price }),
  cancelListing: (id: string) => request<{ ok: true }>('DELETE', `/market/listings/${id}`),
  buyListing: (id: string) => request<{ chips: number; plate: PlateDto }>('POST', `/market/listings/${id}/buy`),

  trades: () => request<{ incoming: TradeOfferDto[]; outgoing: TradeOfferDto[] }>('GET', '/trades'),
  trade: (code: string) => request<TradeOfferDto>('GET', `/trades/${encodeURIComponent(code)}`),
  createTrade: (body: {
    offeredPlateIds: string[];
    requestedPlateIds: string[];
    offeredChips: number;
    requestedChips: number;
    message?: string;
  }) => request<TradeOfferDto>('POST', '/trades', body),
  acceptTrade: (code: string) => request<TradeOfferDto>('POST', `/trades/${code}/accept`),
  declineTrade: (code: string) => request<{ ok: true }>('POST', `/trades/${code}/decline`),
  cancelTrade: (code: string) => request<{ ok: true }>('POST', `/trades/${code}/cancel`),

  leaderboard: (board: LeaderboardBoard) => request<LeaderboardDto>('GET', `/leaderboard${qs({ board })}`),
  quests: () => request<QuestsDto>('GET', '/quests'),
  claimQuest: (id: string) => request<BalanceDto>('POST', `/quests/${id}/claim`),
  claimDaily: () =>
    request<BalanceDto & { reward: { rolls: number; chips: number }; daily: DailyStatusDto }>('POST', '/daily/claim'),
  profile: () => request<ProfileDto>('GET', '/profile'),
  updateSettings: (s: Partial<SettingsDto>) => request<SettingsDto>('PATCH', '/profile/settings', s),

  // --- Машины ---
  carsConfig: () => request<CarsConfigDto>('GET', '/cars/config'),
  showroom: () => request<ShowroomDto>('GET', '/showroom'),
  buyCar: (modelId: string, color?: string) => request<CarDto>('POST', `/showroom/${modelId}/buy`, { color }),
  buyGarageSlot: () => request<{ chips: number; garage: GarageSlotsDto }>('POST', '/garage/slots/buy'),
  itemInvoice: (item: ItemInvoice) => request<{ link: string; paymentId: string }>('POST', '/payments/item-invoice', item),

  cars: () => request<CarGarageDto>('GET', '/cars'),
  userCars: (userId: string) => request<CarDto[]>('GET', `/users/${userId}/cars`),
  car: (id: string) => request<CarCardDto>('GET', `/cars/${id}`),
  mountPlate: (carId: string, plateId: string) => request<CarDto>('POST', `/cars/${carId}/plate`, { plateId }),
  unmountPlate: (carId: string) => request<CarDto>('DELETE', `/cars/${carId}/plate`),
  tuneCar: (carId: string, tuning: CarTuning) => request<CarDto>('PUT', `/cars/${carId}/tuning`, tuning),
  sellCar: (carId: string) => request<{ chips: number; received: number }>('POST', `/cars/${carId}/sell`),
  startTrip: (carId: string, hours: number) => request<CarDto>('POST', `/cars/${carId}/trips`, { hours }),
  collectTrips: () => request<{ trips: number; income: number; chips: number }>('POST', '/trips/collect'),

  carMarket: (f: CarMarketFilters, cursor?: string | null) =>
    request<Page<CarListingDto>>('GET', `/car-market${qs({ ...f, cursor })}`),
  createCarListing: (carId: string, price: number) => request<CarListingDto>('POST', '/car-market/listings', { carId, price }),
  cancelCarListing: (id: string) => request<{ ok: true }>('DELETE', `/car-market/listings/${id}`),
  buyCarListing: (id: string) => request<{ chips: number; carId: string }>('POST', `/car-market/listings/${id}/buy`),

  // --- Гонки, аукцион, выставка ---
  raceQueue: () => request<RaceQueueDto>('GET', '/races/queue'),
  enterRace: (carId: string, bet: number) => request<RaceQueueDto>('POST', '/races/queue', { carId, bet }),
  pollRace: () => request<RaceQueueDto>('POST', '/races/queue/poll'),
  leaveRace: () => request<RaceQueueDto>('DELETE', '/races/queue'),
  raceHistory: () => request<RaceDto[]>('GET', '/races/history'),

  auction: () => request<{ auction: AuctionDto | null }>('GET', '/auction'),
  bid: (auctionId: string, amount: number) => request<AuctionDto>('POST', `/auction/${auctionId}/bids`, { amount }),

  exhibition: () => request<ExhibitionDto>('GET', '/exhibition'),
  enterExhibition: (carId: string) => request<ExhibitionDto>('POST', '/exhibition/entries', { carId }),
  votePair: () => request<VotePairDto>('GET', '/exhibition/pair'),
  vote: (winnerEntryId: string) => request<{ rewarded: boolean; chips: number | null }>('POST', '/exhibition/votes', { winnerEntryId }),

  // --- Клубы, номер мечты, ачивки ---
  clubs: () => request<ClubListItemDto[]>('GET', '/clubs'),
  myClub: () => request<{ club: ClubDto | null }>('GET', '/clubs/mine'),
  club: (id: string) => request<ClubDto>('GET', `/clubs/${id}`),
  createClub: (name: string, chatLink: string | null) => request<ClubDto>('POST', '/clubs', { name, chatLink }),
  joinClub: (id: string) => request<ClubDto>('POST', `/clubs/${id}/join`),
  leaveClub: () => request<{ ok: true }>('POST', '/clubs/leave'),
  updateClubChat: (chatLink: string | null) => request<ClubDto>('PATCH', '/clubs/mine', { chatLink }),
  kickMember: (userId: string) => request<ClubDto>('DELETE', `/clubs/mine/members/${userId}`),

  dreamMasks: () => request<DreamMaskDto[]>('GET', '/dream-masks'),
  addDreamMask: (mask: string) => request<DreamMaskDto>('POST', '/dream-masks', { mask }),
  deleteDreamMask: (id: string) => request<{ ok: true }>('DELETE', `/dream-masks/${id}`),

  achievements: () => request<AchievementsDto>('GET', '/achievements'),
  setTitle: (title: AchievementId | null) => request<{ title: AchievementId | null }>('PUT', '/profile/title', { title }),
};
