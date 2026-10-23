import type { AuctionConfig } from './car-config';
import type { Rng } from './generator';

const SECOND = 1000;

export type AuctionTier = 'legendary' | 'mythic';

/** Тир номера для ежедневного лота. */
export function rollAuctionTier(rng: Rng, cfg: AuctionConfig): AuctionTier {
  const { legendary, mythic } = cfg.tierWeights;
  return rng.int(legendary + mythic) < legendary ? 'legendary' : 'mythic';
}

export function auctionStartPrice(plateValue: number, cfg: AuctionConfig): number {
  return Math.max(1, Math.round(plateValue * cfg.startPriceFactor));
}

/** Минимальная допустимая ставка: стартовая цена или текущая + шаг. */
export function minNextBid(currentBid: number | null, startPrice: number, cfg: AuctionConfig): number {
  if (currentBid === null) return startPrice;
  const step = Math.max(cfg.minIncrementChips, Math.ceil((currentBid * cfg.minIncrementPercent) / 100));
  return currentBid + step;
}

export type BidError = 'auction_ended' | 'bid_too_low' | 'already_leading';

export function validateBid(
  bid: { amount: number; bidderId: string; at: Date },
  state: { currentBid: number | null; leaderId: string | null; startPrice: number; endsAt: Date },
  cfg: AuctionConfig,
): BidError | null {
  if (bid.at.getTime() >= state.endsAt.getTime()) return 'auction_ended';
  if (state.leaderId === bid.bidderId) return 'already_leading';
  if (!Number.isInteger(bid.amount) || bid.amount < minNextBid(state.currentBid, state.startPrice, cfg)) {
    return 'bid_too_low';
  }
  return null;
}

/**
 * Антиснайпинг: ставка в последние antiSnipeSeconds сдвигает окончание так,
 * чтобы оставалось extendSeconds, но не дальше maxExtensionMinutes от исходного окончания.
 */
export function endsAtAfterBid(endsAt: Date, originalEndsAt: Date, bidAt: Date, cfg: AuctionConfig): Date {
  const left = endsAt.getTime() - bidAt.getTime();
  if (left > cfg.antiSnipeSeconds * SECOND) return endsAt;
  const limit = originalEndsAt.getTime() + cfg.maxExtensionMinutes * 60 * SECOND;
  const extended = Math.min(bidAt.getTime() + cfg.extendSeconds * SECOND, limit);
  return new Date(Math.max(endsAt.getTime(), extended));
}
