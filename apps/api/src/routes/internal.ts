import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parse } from '../lib/validate';
import { plateCard } from '../services/garage';
import { confirmPayment, paymentEventSchema, preCheckout, successfulPaymentSchema } from '../services/payments';

/** Внутренние эндпоинты для бота (/internal/*), защищены INTERNAL_API_TOKEN. */
export async function internalRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/payments/pre-checkout', async (req) => preCheckout(ctx, parse(paymentEventSchema, req.body)));

  app.post('/payments/success', async (req) => confirmPayment(ctx, parse(successfulPaymentSchema, req.body)));

  /** Данные номера для inline-шаринга. */
  app.get('/plates/:key', async (req) => plateCard(ctx, parse(z.object({ key: z.string() }), req.params).key));

  /** Бот получил 403 — пользователь заблокировал бота, перестаём слать уведомления. */
  app.post('/users/:telegramId/blocked', async (req) => {
    const { telegramId } = parse(z.object({ telegramId: z.string().regex(/^\d+$/) }), req.params);
    const { blocked } = parse(z.object({ blocked: z.boolean() }), req.body);
    await ctx.prisma.user.updateMany({ where: { telegramId: BigInt(telegramId) }, data: { botBlocked: blocked } });
    return { ok: true };
  });
}
