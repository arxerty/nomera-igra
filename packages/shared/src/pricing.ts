import type { PriceConfig } from './config';
import type { RarityResult } from './rarity';

/** Цена продажи номера системе в Фишках. Она же — «ценность» номера в рейтинге. */
export function plateValue(rarity: RarityResult, prices: PriceConfig): number {
  const multiplier = rarity.bonuses.reduce((m, b) => m * prices.bonusMultipliers[b], 1);
  return Math.round(prices.base[rarity.tier] * multiplier);
}

/** Разбивка сделки на рынке: сколько получит продавец и сколько удержит комиссия. */
export function marketSettlement(price: number, feePercent: number) {
  const fee = Math.floor((price * feePercent) / 100);
  return { price, fee, sellerReceives: price - fee };
}
