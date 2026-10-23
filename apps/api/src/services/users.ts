import { Prisma, type User } from '@prisma/client';
import { isFreeRollReady, nextFreeRollAt, type MeDto } from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { WITH_ACTIVE_LISTING, withTx } from '../lib/db';
import { localeFromLanguageCode, plateDto, settingsDto, userPublic } from '../lib/dto';
import { changeBalance } from '../lib/ledger';
import type { ValidatedInitData } from '../lib/telegram-auth';
import { dailyStatus } from './quests';

/** start_param реферальной ссылки: "ref_<telegramId>". */
export function parseReferral(startParam: string | null): bigint | null {
  const m = startParam ? /^ref_(\d{1,20})$/.exec(startParam) : null;
  return m ? BigInt(m[1]!) : null;
}

export function isAdmin(ctx: AppContext, user: Pick<User, 'telegramId'>): boolean {
  return ctx.env.ADMIN_TELEGRAM_IDS.has(user.telegramId);
}

/** Вход по проверенной initData: обновляет профиль или регистрирует нового игрока. */
export async function loginWithInitData(ctx: AppContext, data: ValidatedInitData): Promise<User> {
  const telegramId = BigInt(data.user.id);
  const profile = {
    username: data.user.username ?? null,
    firstName: data.user.first_name,
    lastName: data.user.last_name ?? null,
    photoUrl: data.user.photo_url ?? null,
    lastSeenAt: ctx.now(),
  };

  const existing = await ctx.prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    return ctx.prisma.user.update({
      where: { id: existing.id },
      data: data.dev ? { lastSeenAt: profile.lastSeenAt } : profile,
    });
  }

  try {
    return await registerUser(ctx, telegramId, profile, data);
  } catch (err) {
    // Параллельный первый вход: пользователя уже создал соседний запрос.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return ctx.prisma.user.update({ where: { telegramId }, data: profile });
    }
    throw err;
  }
}

async function registerUser(
  ctx: AppContext,
  telegramId: bigint,
  profile: Pick<User, 'username' | 'firstName' | 'lastName' | 'photoUrl' | 'lastSeenAt'>,
  data: ValidatedInitData,
): Promise<User> {
  const { config } = await ctx.config.get();
  const { economy } = config;
  const referrerTgId = parseReferral(data.startParam);

  const { user, referrer } = await withTx(ctx.prisma, async (tx) => {
    const referrer =
      referrerTgId !== null && referrerTgId !== telegramId
        ? await tx.user.findUnique({ where: { telegramId: referrerTgId } })
        : null;
    const created = await tx.user.create({
      data: {
        ...profile,
        telegramId,
        locale: localeFromLanguageCode(data.user.language_code),
        referredById: referrer?.id,
      },
    });
    await changeBalance(tx, { userId: created.id, currency: 'chips', delta: economy.startingChips, reason: 'starting_bonus' });
    await changeBalance(tx, { userId: created.id, currency: 'rolls', delta: economy.startingRolls, reason: 'starting_bonus' });
    if (referrer) {
      await changeBalance(tx, {
        userId: referrer.id,
        currency: 'chips',
        delta: economy.referralRewardChips,
        reason: 'referral_reward',
        refId: created.id,
      });
    }
    return { user: await tx.user.findUniqueOrThrow({ where: { id: created.id } }), referrer };
  });

  if (referrer) {
    await afterCommit(
      ctx,
      ctx.notifier.send(referrer, {
        type: 'referral_joined',
        name: user.firstName,
        reward: economy.referralRewardChips,
      }),
    );
  }
  return user;
}

export async function getMe(ctx: AppContext, user: User): Promise<MeDto> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const { economy } = config;

  const lastRoll = await ctx.prisma.rollLog.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { plate: { include: WITH_ACTIVE_LISTING } },
  });
  const freeRollReady = isFreeRollReady(user.lastFreeRollAt, economy.freeRollIntervalHours, now);

  return {
    user: { ...userPublic(user), telegramId: user.telegramId.toString(), isAdmin: isAdmin(ctx, user) },
    chips: user.chips,
    rolls: user.rolls,
    freeRollAt: freeRollReady
      ? null
      : nextFreeRollAt(user.lastFreeRollAt, economy.freeRollIntervalHours)!.toISOString(),
    serverTime: now.toISOString(),
    lastPlate: lastRoll ? plateDto(lastRoll.plate) : null,
    daily: dailyStatus(user, config, now),
    settings: settingsDto(user),
    economy: {
      rollCostChips: economy.rollCostChips,
      freeRollIntervalHours: economy.freeRollIntervalHours,
      marketFeePercent: economy.marketFeePercent,
      minListingPrice: economy.minListingPrice,
      maxListingPrice: economy.maxListingPrice,
    },
    starPacks: config.stars.packs,
  };
}
