import { isCarClassAtLeast, type CarClass } from './cars';
import { STREAK_BREAKERS, type QuestConfig, type QuestEvent } from './config';
import { TIER_RANK, type Tier } from './rarity';

export interface QuestEventContext {
  tier?: Tier;
  carClass?: CarClass;
  /** Для режима count/streak: на сколько продвинуть (по умолчанию 1). */
  count?: number;
  /** Для режима max: сообщённое значение (например, размер серии). */
  value?: number;
}

/**
 * Новый прогресс ежедневного задания после события.
 * null — событие задание не затрагивает (или оно уже выполнено), писать в БД нечего.
 */
export function nextQuestProgress(
  quest: QuestConfig,
  current: number,
  event: QuestEvent,
  ctx: QuestEventContext = {},
): number | null {
  if (current >= quest.target) return null;
  const mode = quest.mode ?? 'count';

  if (mode === 'streak' && event === STREAK_BREAKERS[quest.event]) return current > 0 ? 0 : null;
  if (event !== quest.event) return null;
  if (quest.minTier && (!ctx.tier || TIER_RANK[ctx.tier] < TIER_RANK[quest.minTier])) return null;
  if (quest.minCarClass && (!ctx.carClass || !isCarClassAtLeast(ctx.carClass, quest.minCarClass))) return null;

  if (mode === 'max') {
    const value = Math.min(ctx.value ?? 0, quest.target);
    return value > current ? value : null;
  }
  return Math.min(current + (ctx.count ?? 1), quest.target);
}
