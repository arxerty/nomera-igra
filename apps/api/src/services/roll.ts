import { randomUUID } from 'node:crypto';
import {
  isFreeRollReady,
  nextFreeRollAt,
  plateBody,
  plateKey,
  plateValue,
  rollUniquePlate,
  type Plate,
  type RarityResult,
  type RollResultDto,
  type RollSource,
} from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING, lockUsers, withTx, type Tx } from '../lib/db';
import { plateDto } from '../lib/dto';
import { AppError, badRequest } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { cryptoRng } from '../lib/rng';
import { leaderboardPeriod } from './leaderboard';
import { trackQuest } from './quests';

/**
 * Атомарно занимает номер: вставляет новый или забирает свободный из пула
 * (ownerId IS NULL и не разыгрывается на аукционе). Если номер уже чей-то, возвращает null — без ошибки,
 * чтобы не обрывать транзакцию.
 */
async function claimPlate(
  tx: Tx,
  args: { plate: Plate; rarity: RarityResult; value: number; userId: string; at: Date },
): Promise<string | null> {
  const { plate, rarity, value, userId, at } = args;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Plate" (id, key, body, letters, number, region, tier, value, traits, bonuses,
                         "ownerId", "acquiredAt", "firstRolledAt", "rolledTimes")
    VALUES (${randomUUID()}, ${plateKey(plate)}, ${plateBody(plate)}, ${plate.letters}, ${plate.number},
            ${plate.region}, ${rarity.tier}::"Tier", ${value}, ${rarity.traits}::text[], ${rarity.bonuses}::text[],
            ${userId}, ${at}, ${at}, 1)
    ON CONFLICT (key) DO UPDATE SET
      "ownerId" = EXCLUDED."ownerId",
      "acquiredAt" = EXCLUDED."acquiredAt",
      tier = EXCLUDED.tier,
      value = EXCLUDED.value,
      traits = EXCLUDED.traits,
      bonuses = EXCLUDED.bonuses,
      "rolledTimes" = "Plate"."rolledTimes" + 1
    WHERE "Plate"."ownerId" IS NULL AND NOT "Plate".reserved
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/**
 * Выбивание номера. Порядок источников: бесплатная попытка по таймеру,
 * затем баланс попыток. Номер генерируется только здесь, криптостойким ГПСЧ.
 */
export async function performRoll(ctx: AppContext, userId: string): Promise<RollResultDto> {
  const { version, config } = await ctx.config.get();
  const { economy } = config;
  const now = ctx.now();
  const generator = { regions: config.regions, rarity: config.rarity };

  const result = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });

    let source: RollSource;
    if (isFreeRollReady(before.lastFreeRollAt, economy.freeRollIntervalHours, now)) {
      source = 'free';
      await tx.user.update({ where: { id: userId }, data: { lastFreeRollAt: now } });
    } else {
      source = 'balance';
      await changeBalance(tx, { userId, currency: 'rolls', delta: -1, reason: 'roll_spend' });
    }

    const claimed = { id: null as string | null };
    const rolled = await rollUniquePlate({
      odds: config.odds,
      rng: cryptoRng,
      config: generator,
      tryClaim: async (plate, rarity) => {
        const value = plateValue(rarity, config.prices);
        claimed.id = await claimPlate(tx, { plate, rarity, value, userId, at: now });
        return claimed.id !== null;
      },
    });
    if (!rolled || !claimed.id) throw new AppError(503, 'pool_exhausted', 'Свободные номера закончились');

    const plate = await tx.plate.findUniqueOrThrow({ where: { id: claimed.id }, include: WITH_ACTIVE_LISTING });
    await tx.plateOwnership.create({
      data: { plateId: plate.id, userId, acquiredAt: now, acquiredVia: 'roll' },
    });
    await tx.rollLog.create({
      data: {
        userId,
        plateId: plate.id,
        plateKey: plate.key,
        rolledTier: rolled.rolledTier,
        tier: plate.tier,
        value: plate.value,
        source,
        configVersion: version,
      },
    });
    const user = await tx.user.update({ where: { id: userId }, data: { totalRolls: { increment: 1 } } });
    await trackQuest(tx, config, userId, 'roll', { at: now, tier: plate.tier });
    return { plate, user, source, rolledTier: rolled.rolledTier };
  });

  const { plate, user, source } = result;
  const freeAt = nextFreeRollAt(user.lastFreeRollAt, economy.freeRollIntervalHours);
  const tasks: Promise<unknown>[] = [
    ctx.leaderboard.refreshUsers([userId]),
    ctx.leaderboard.addRollValue(userId, plate.value, leaderboardPeriod(now, economy.dayOffsetHours)),
  ];
  if (source === 'free' && freeAt) {
    tasks.push(
      ctx.notifier.send(
        user,
        { type: 'free_roll_ready' },
        { delayMs: freeAt.getTime() - now.getTime(), jobId: `free_roll-${userId}-${freeAt.getTime()}` },
      ),
    );
  }
  await afterCommit(ctx, ...tasks);

  return {
    plate: plateDto(plate),
    rolledTier: result.rolledTier,
    source,
    chips: user.chips,
    rolls: user.rolls,
    freeRollAt: isFreeRollReady(user.lastFreeRollAt, economy.freeRollIntervalHours, now) ? null : freeAt!.toISOString(),
  };
}

export const MAX_ROLLS_PER_PURCHASE = 10;

/** Покупка попыток за Фишки. */
export async function buyRollsWithChips(ctx: AppContext, userId: string, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROLLS_PER_PURCHASE) {
    throw badRequest(`Можно купить от 1 до ${MAX_ROLLS_PER_PURCHASE} попыток`);
  }
  const { config } = await ctx.config.get();
  const cost = count * config.economy.rollCostChips;
  return withTx(ctx.prisma, async (tx) => {
    const refId = randomUUID();
    const chips = await changeBalance(tx, { userId, currency: 'chips', delta: -cost, reason: 'roll_purchase', refId });
    const rolls = await changeBalance(tx, { userId, currency: 'rolls', delta: count, reason: 'roll_purchase', refId });
    return { chips, rolls };
  });
}
