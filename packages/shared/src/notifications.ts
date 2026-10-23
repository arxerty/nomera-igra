import type { Locale } from './tier-meta';
import type { Tier } from './rarity';

/** Очередь BullMQ, через которую API передаёт уведомления боту. */
export const NOTIFICATION_QUEUE = 'notifications';

interface Base {
  /** Telegram ID получателя (строкой: BigInt не сериализуется в JSON). */
  telegramId: string;
  locale: Locale;
}

export type NotificationJob =
  | (Base & { type: 'free_roll_ready' })
  | (Base & { type: 'plate_sold'; plate: string; tier: Tier; price: number; received: number })
  | (Base & { type: 'trade_offer'; code: string; fromName: string })
  | (Base & { type: 'trade_accepted'; code: string; byName: string })
  | (Base & { type: 'referral_joined'; name: string; reward: number })
  | (Base & { type: 'car_sold'; car: string; price: number; received: number })
  | (Base & { type: 'trip_returned'; car: string; income: number; event: { ru: string; en: string } | null })
  | (Base & { type: 'race_finished'; won: boolean; opponent: string; payout: number })
  | (Base & { type: 'auction_outbid'; plate: string; amount: number })
  | (Base & { type: 'auction_won'; plate: string; price: number })
  | (Base & { type: 'dream_plate'; plate: string; mask: string; source: 'market' | 'auction'; price: number })
  | (Base & { type: 'reward'; reason: 'exhibition' | 'tournament'; place: number; chips: number; rolls: number });

export type NotificationType = NotificationJob['type'];

/**
 * Очередь подтверждения оплат Stars внутри бота: successful_payment сначала
 * кладётся сюда и подтверждается в API с повторами — деньги не потеряются,
 * даже если API в этот момент недоступен.
 */
export const PAYMENT_QUEUE = 'payments';

export interface PaymentJob {
  payload: string;
  telegramUserId: string;
  chatId: number;
  locale: Locale;
  currency: string;
  totalAmount: number;
  telegramChargeId: string;
  providerChargeId?: string;
}
