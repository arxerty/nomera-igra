import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import {
  STREAK_BREAKERS,
  dailyStreakReward,
  gameDayKey,
  nextGameDayStart,
  nextQuestProgress,
  previousDayKey,
  type DailyStatusDto,
  type GameConfig,
  type Locale,
  type QuestEvent,
  type QuestEventContext,
  type QuestsDto,
} from '@nomer/shared';
import type { AppContext } from '../context';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { AppError, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';

/**
 * Засчитывает событие в ежедневные задания (вызывается внутри транзакции операции).
 * Правила — nextQuestProgress из @nomer/shared: счёт, серия «подряд», максимум.
 */
export async function trackQuest(
  tx: Tx,
  config: GameConfig,
  userId: string,
  event: QuestEvent,
  opts: { at: Date } & QuestEventContext,
): Promise<void> {
  const day = gameDayKey(opts.at, config.economy.dayOffsetHours);
  for (const q of config.quests) {
    if (q.event !== event && STREAK_BREAKERS[q.event] !== event) continue;
    // Строка задания создаётся и блокируется, чтобы параллельные события не потеряли прогресс.
    const rows = await tx.$queryRaw<{ progress: number }[]>`
      INSERT INTO "QuestProgress" (id, "userId", "questId", day, progress)
      VALUES (${randomUUID()}, ${userId}, ${q.id}, ${day}, 0)
      ON CONFLICT ("userId", "questId", day) DO UPDATE SET progress = "QuestProgress".progress
      RETURNING progress`;
    const next = nextQuestProgress(q, rows[0]!.progress, event, opts);
    if (next === null) continue;
    await tx.questProgress.update({
      where: { userId_questId_day: { userId, questId: q.id, day } },
      data: { progress: next },
    });
  }
}

export function dailyStatus(user: Pick<User, 'streakDay' | 'lastDailyClaim'>, config: GameConfig, now: Date): DailyStatusDto {
  const { economy } = config;
  const today = gameDayKey(now, economy.dayOffsetHours);
  const claimedToday = user.lastDailyClaim === today;
  const continues = user.lastDailyClaim === previousDayKey(today);
  const streak = claimedToday || continues ? user.streakDay : 0;
  return {
    streak,
    canClaim: !claimedToday,
    nextReward: dailyStreakReward(economy, streak + 1),
    resetsAt: nextGameDayStart(now, economy.dayOffsetHours).toISOString(),
  };
}

export async function claimDaily(ctx: AppContext, userId: string) {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const today = gameDayKey(now, config.economy.dayOffsetHours);

  return withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const status = dailyStatus(user, config, now);
    if (!status.canClaim) throw new AppError(409, 'already_claimed', 'Бонус за сегодня уже получен');

    const streak = status.streak + 1;
    const reward = dailyStreakReward(config.economy, streak);
    await tx.user.update({ where: { id: userId }, data: { streakDay: streak, lastDailyClaim: today } });
    const refId = `daily:${today}`;
    const chips = await changeBalance(tx, { userId, currency: 'chips', delta: reward.chips, reason: 'daily_bonus', refId });
    const rolls = await changeBalance(tx, { userId, currency: 'rolls', delta: reward.rolls, reason: 'daily_bonus', refId });
    return {
      reward,
      chips,
      rolls,
      daily: dailyStatus({ streakDay: streak, lastDailyClaim: today }, config, now),
    };
  });
}

export async function getQuests(ctx: AppContext, user: User): Promise<QuestsDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const day = gameDayKey(now, config.economy.dayOffsetHours);
  const progress = await ctx.prisma.questProgress.findMany({ where: { userId: user.id, day } });
  const byId = new Map(progress.map((p) => [p.questId, p]));
  const locale = user.locale as Locale;

  return {
    quests: config.quests.map((q) => {
      const p = byId.get(q.id);
      return {
        id: q.id,
        title: q.title[locale] ?? q.title.ru,
        target: q.target,
        progress: p?.progress ?? 0,
        rewardChips: q.rewardChips,
        rewardRolls: q.rewardRolls,
        claimed: Boolean(p?.claimedAt),
      };
    }),
    daily: dailyStatus(user, config, now),
  };
}

export async function claimQuest(ctx: AppContext, userId: string, questId: string) {
  const { config } = await ctx.config.get();
  const quest = config.quests.find((q) => q.id === questId);
  if (!quest) throw notFound('Задание не найдено');
  const now = ctx.now();
  const day = gameDayKey(now, config.economy.dayOffsetHours);

  return withTx(ctx.prisma, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; progress: number; claimedAt: Date | null }[]>`
      SELECT id, progress, "claimedAt" FROM "QuestProgress"
      WHERE "userId" = ${userId} AND "questId" = ${questId} AND day = ${day}
      FOR UPDATE`;
    const row = rows[0];
    if (!row || row.progress < quest.target) throw new AppError(409, 'quest_incomplete', 'Задание ещё не выполнено');
    if (row.claimedAt) throw new AppError(409, 'already_claimed', 'Награда уже получена');

    await tx.questProgress.update({ where: { id: row.id }, data: { claimedAt: now } });
    const refId = `quest:${questId}:${day}`;
    const chips = await changeBalance(tx, { userId, currency: 'chips', delta: quest.rewardChips, reason: 'quest_reward', refId });
    const rolls = await changeBalance(tx, { userId, currency: 'rolls', delta: quest.rewardRolls, reason: 'quest_reward', refId });
    return { chips, rolls };
  });
}
