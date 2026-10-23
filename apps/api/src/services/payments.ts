import type { Payment, User } from '@prisma/client';
import { z } from 'zod';
import { PAINT_FINISHES, carModelTitle, gameDayKey, showroomForDay } from '@nomer/shared';
import type { AppContext } from '../context';
import { assertGarageSpace, garageSlotsDto, lockOwnedCar, modelFromRow, parseTuning } from '../lib/cars';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';
import { callBotApi, createStarsInvoiceLink } from '../lib/telegram-api';
import { trackQuest } from './quests';
import { createCar } from './showroom';

/** Данные платежа, которые бот пересылает из pre_checkout_query / successful_payment. */
export const paymentEventSchema = z.object({
  payload: z.string().min(1),
  telegramUserId: z.string().regex(/^\d+$/),
  currency: z.string(),
  totalAmount: z.number().int(),
});
export const successfulPaymentSchema = paymentEventSchema.extend({
  telegramChargeId: z.string().min(1),
  providerChargeId: z.string().optional(),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type SuccessfulPayment = z.infer<typeof successfulPaymentSchema>;

/** Покупка за Stars, кроме пакетов попыток. */
export const itemInvoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('car'), modelId: z.string(), color: z.string().optional() }),
  z.object({ kind: z.literal('paint'), carId: z.string(), finish: z.enum(PAINT_FINISHES), color: z.string() }),
  z.object({ kind: z.literal('garage_slot') }),
]);
export type ItemInvoice = z.infer<typeof itemInvoiceSchema>;

const INVOICE_TEXT = {
  ru: {
    rolls: (n: number) => ({ title: `Попытки ×${n}`, description: `${n} попыток выбить номер в «Номерном Фарте»` }),
    car: (name: string) => ({ title: name, description: `Машина «${name}» в ваш гараж` }),
    paint: (finish: string) => ({ title: `Покраска: ${finish}`, description: 'Покраска машины в «Номерном Фарте»' }),
    garage_slot: () => ({ title: 'Место в гараже', description: 'Ещё одно место для машины' }),
  },
  en: {
    rolls: (n: number) => ({ title: `Rolls ×${n}`, description: `${n} plate rolls in Lucky Plates` }),
    car: (name: string) => ({ title: name, description: `${name} for your garage` }),
    paint: (finish: string) => ({ title: `Paint: ${finish}`, description: 'Car paint in Lucky Plates' }),
    garage_slot: () => ({ title: 'Garage slot', description: 'One more slot for a car' }),
  },
};

const textFor = (user: User) => INVOICE_TEXT[user.locale === 'en' ? 'en' : 'ru'];

async function issueInvoice(ctx: AppContext, payment: Payment, text: { title: string; description: string }) {
  const link = await createStarsInvoiceLink(ctx.env.BOT_TOKEN, {
    ...text,
    payload: payment.id,
    stars: payment.stars,
    label: text.title,
  });
  return { link, paymentId: payment.id };
}

export async function createInvoice(ctx: AppContext, user: User, packId: string) {
  const { config } = await ctx.config.get();
  const pack = config.stars.packs.find((p) => p.id === packId);
  if (!pack) throw notFound('Пакет не найден');
  const payment = await ctx.prisma.payment.create({
    data: { userId: user.id, kind: 'rolls', packId: pack.id, stars: pack.stars, rolls: pack.rolls },
  });
  return issueInvoice(ctx, payment, textFor(user).rolls(pack.rolls));
}

/** Инвойс на машину премиум-класса, редкую покраску или место в гараже. Всё перепроверяется при оплате. */
export async function createItemInvoice(ctx: AppContext, user: User, item: ItemInvoice) {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const text = textFor(user);
  switch (item.kind) {
    case 'car': {
      const rows = await ctx.prisma.carModel.findMany({ where: { retired: false } });
      const today = showroomForDay(
        rows.map(modelFromRow),
        gameDayKey(now, config.economy.dayOffsetHours),
        config.cars.showroom.rotatingSlots,
        new Map(rows.map((r) => [r.id, r.sold])),
      );
      const model = today.find((m) => m.id === item.modelId);
      if (!model) throw new AppError(409, 'not_in_showroom', 'Этой модели сегодня нет в салоне');
      if (!model.priceStars) throw badRequest('Эта модель продаётся только за Фишки');
      await withTx(ctx.prisma, (tx) => assertGarageSpace(tx, user.id, config));
      const payment = await ctx.prisma.payment.create({
        data: { userId: user.id, kind: 'car', packId: model.id, stars: model.priceStars, meta: { color: item.color ?? null } },
      });
      return issueInvoice(ctx, payment, text.car(carModelTitle(model)));
    }
    case 'paint': {
      const stars = config.cars.tuning.paintStars[item.finish];
      if (stars <= 0) throw badRequest('Эту покраску нельзя купить за Stars');
      if (!config.cars.tuning.palette.includes(item.color)) throw badRequest('Такого цвета нет в палитре');
      const car = await ctx.prisma.userCar.findUnique({ where: { id: item.carId } });
      if (!car || car.ownerId !== user.id) throw new AppError(403, 'not_owner', 'Это не ваша машина');
      const payment = await ctx.prisma.payment.create({
        data: { userId: user.id, kind: 'paint', packId: item.finish, stars, meta: { carId: item.carId, color: item.color } },
      });
      return issueInvoice(ctx, payment, text.paint(item.finish));
    }
    case 'garage_slot': {
      const used = await ctx.prisma.userCar.count({ where: { ownerId: user.id } });
      const slots = garageSlotsDto(user, used, config);
      if (!slots.nextSlot) throw new AppError(409, 'limit_reached', 'Гараж уже максимального размера');
      const payment = await ctx.prisma.payment.create({
        data: { userId: user.id, kind: 'garage_slot', packId: 'slot', stars: slots.nextSlot.stars },
      });
      return issueInvoice(ctx, payment, text.garage_slot());
    }
  }
}

function checkPayment(
  payment: { status: string; stars: number; user: { telegramId: bigint } } | null,
  e: PaymentEvent,
): string | null {
  if (!payment) return 'Платёж не найден';
  if (payment.user.telegramId.toString() !== e.telegramUserId) return 'Платёж принадлежит другому пользователю';
  if (e.currency !== 'XTR') return 'Неверная валюта';
  if (e.totalAmount !== payment.stars) return 'Неверная сумма';
  return null;
}

/** Можно ли ещё выдать покупку: тираж не распродан, гараж не максимальный. */
async function fulfillmentProblem(ctx: AppContext, payment: Payment): Promise<string | null> {
  const { config } = await ctx.config.get();
  if (payment.kind === 'car') {
    const model = await ctx.prisma.carModel.findUnique({ where: { id: payment.packId } });
    if (!model || model.retired) return 'Модель больше не продаётся';
    if (model.editionSize !== null && model.sold >= model.editionSize) return 'Тираж распродан';
  }
  if (payment.kind === 'garage_slot') {
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: payment.userId } });
    if (!garageSlotsDto(user, 0, config).nextSlot) return 'Гараж уже максимального размера';
  }
  return null;
}

/** Ответ на pre_checkout_query: можно ли проводить платёж. */
export async function preCheckout(ctx: AppContext, e: PaymentEvent): Promise<{ ok: true } | { ok: false; error: string }> {
  const payment = await ctx.prisma.payment.findUnique({ where: { id: e.payload }, include: { user: true } });
  const error =
    checkPayment(payment, e) ??
    (payment?.status !== 'pending' ? 'Платёж уже обработан' : null) ??
    (payment ? await fulfillmentProblem(ctx, payment) : null);
  return error ? { ok: false, error } : { ok: true };
}

/** Выдаёт оплаченное. AppError — выдать нельзя (тираж кончился и т.п.), Stars вернутся. */
async function fulfill(ctx: AppContext, tx: Tx, payment: Payment): Promise<void> {
  const { config } = await ctx.config.get();
  const now = ctx.now();
  const meta = (payment.meta ?? {}) as { color?: string | null; carId?: string };
  switch (payment.kind) {
    case 'rolls':
      await changeBalance(tx, { userId: payment.userId, currency: 'rolls', delta: payment.rolls, reason: 'stars_purchase', refId: payment.id });
      return;
    case 'car': {
      // Место в гараже проверено при выставлении счёта; деньги уже списаны, поэтому машина выдаётся и сверх лимита.
      const car = await createCar(tx, {
        userId: payment.userId,
        modelId: payment.packId,
        color: meta.color ?? undefined,
        price: null,
        at: now,
        config,
      });
      const model = await tx.carModel.findUniqueOrThrow({ where: { id: car.modelId } });
      await trackQuest(tx, config, payment.userId, 'car_buy', { at: now, carClass: model.class });
      return;
    }
    case 'paint': {
      const car = await lockOwnedCar(tx, meta.carId ?? '', payment.userId);
      const tuning = parseTuning(car.tuning);
      await tx.userCar.update({
        where: { id: car.id },
        data: { tuning: { ...tuning, paint: { finish: payment.packId, color: meta.color } } as object },
      });
      return;
    }
    case 'garage_slot': {
      const user = await tx.user.findUniqueOrThrow({ where: { id: payment.userId } });
      if (!garageSlotsDto(user, 0, config).nextSlot) throw new AppError(409, 'limit_reached', 'Гараж уже максимального размера');
      await tx.user.update({ where: { id: payment.userId }, data: { extraGarageSlots: { increment: 1 } } });
      return;
    }
  }
}

/**
 * successful_payment: выдаёт покупку ровно один раз. Повторная доставка того же
 * платежа (ретраи бота) вернёт duplicate: true без второй выдачи. Если выдать уже
 * нельзя (последний экземпляр тиража купили, пока игрок платил), Stars возвращаются.
 */
export async function confirmPayment(ctx: AppContext, e: SuccessfulPayment) {
  const outcome = await withTx(ctx.prisma, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Payment" WHERE id = ${e.payload} FOR UPDATE`;
    if (!locked[0]) throw new AppError(400, 'payment_invalid', 'Платёж не найден');
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: e.payload }, include: { user: true } });

    if (payment.status !== 'pending') {
      return { duplicate: true, payment, refunded: payment.status === 'refunded' };
    }
    const error = checkPayment(payment, e);
    if (error) {
      ctx.log.error({ paymentId: payment.id, error, event: e }, 'Оплата прошла, но не сходится с платежом — нужен ручной разбор');
      throw new AppError(400, 'payment_invalid', error);
    }
    await lockUsers(tx, [payment.userId]);
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'paid', paidAt: ctx.now(), telegramChargeId: e.telegramChargeId, providerChargeId: e.providerChargeId ?? null },
    });
    await fulfill(ctx, tx, payment);
    return { duplicate: false, payment, refunded: false };
  }).catch(async (err: unknown) => {
    if (!(err instanceof AppError) || err.code === 'payment_invalid') throw err;
    // Выдать нельзя: фиксируем возврат и возвращаем Stars через Bot API.
    const payment = await ctx.prisma.payment.update({
      where: { id: e.payload },
      data: { status: 'refunded', telegramChargeId: e.telegramChargeId, providerChargeId: e.providerChargeId ?? null },
    });
    try {
      await callBotApi(ctx.env.BOT_TOKEN, 'refundStarPayment', {
        user_id: Number(e.telegramUserId),
        telegram_payment_charge_id: e.telegramChargeId,
      });
    } catch (refundErr) {
      ctx.log.error({ err: refundErr, paymentId: payment.id }, 'Не удалось вернуть Stars — нужен ручной возврат');
    }
    ctx.log.warn({ paymentId: payment.id, reason: err.message }, 'Покупка не выдана, Stars возвращены');
    return { duplicate: false, payment, refunded: true };
  });

  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: outcome.payment.userId } });
  if (!outcome.duplicate && !outcome.refunded && outcome.payment.kind !== 'rolls') {
    await ctx.leaderboard.refreshUsers([user.id]).catch((err: unknown) => ctx.log.error({ err }, 'Рейтинг не обновлён'));
  }
  return {
    ok: true as const,
    duplicate: outcome.duplicate,
    kind: outcome.payment.kind,
    refunded: outcome.refunded,
    rolls: user.rolls,
  };
}
