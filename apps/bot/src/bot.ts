import { autoRetry } from '@grammyjs/auto-retry';
import type { Queue } from 'bullmq';
import { Bot, InlineKeyboard } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import { parsePlate, plateKey, type PaymentJob } from '@nomer/shared';
import type { Env } from './env';
import { InternalApiError, type InternalApi } from './internal-api';
import { T, localeOf } from './texts';

export function miniAppLink(env: Env, startParam?: string): string {
  const base = `https://t.me/${env.BOT_USERNAME}/${env.MINI_APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

/** start-параметр, который можно передать в Mini App: ref_*, trade_*, plate_*. */
function safeStartParam(payload: string): string | undefined {
  return /^(ref|trade|plate)_[A-Za-z0-9_-]{1,64}$/.test(payload) ? payload : undefined;
}

export function createBot(env: Env, api: InternalApi, payments: Queue<PaymentJob>) {
  const bot = new Bot(env.BOT_TOKEN);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));

  bot.command('start', async (ctx) => {
    const t = T[localeOf(ctx.from?.language_code)];
    const startParam = safeStartParam(ctx.match.trim());
    // Параметр запуска доходит до Mini App только через t.me-ссылку (start_param в initData).
    const keyboard = startParam
      ? new InlineKeyboard().url(t.play, miniAppLink(env, startParam))
      : new InlineKeyboard().webApp(t.play, env.WEB_APP_URL);
    await ctx.reply(t.welcome(ctx.from?.first_name ?? ''), { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.command('help', async (ctx) => {
    const t = T[localeOf(ctx.from?.language_code)];
    await ctx.reply(t.help.replace('{bot}', env.BOT_USERNAME));
  });

  // Обязательная команда для ботов с платежами Telegram Stars.
  bot.command('paysupport', async (ctx) => {
    await ctx.reply(T[localeOf(ctx.from?.language_code)].paysupport);
  });

  // --- Оплата Telegram Stars ---
  bot.on('pre_checkout_query', async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const t = T[localeOf(q.from.language_code)];
    try {
      const res = await api.preCheckout({
        payload: q.invoice_payload,
        telegramUserId: String(q.from.id),
        currency: q.currency,
        totalAmount: q.total_amount,
      });
      if (res.ok) await ctx.answerPreCheckoutQuery(true);
      else await ctx.answerPreCheckoutQuery(false, res.error);
    } catch (err) {
      console.error('pre_checkout_query failed', err);
      await ctx.answerPreCheckoutQuery(false, t.preCheckoutError);
    }
  });

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    // Начисление идёт через очередь с повторами: деньги уже списаны, терять событие нельзя.
    // jobId = charge id, поэтому повторная доставка update не создаст второе начисление.
    await payments.add(
      'confirm',
      {
        payload: p.invoice_payload,
        telegramUserId: String(ctx.from!.id),
        chatId: ctx.chat.id,
        locale: localeOf(ctx.from?.language_code),
        currency: p.currency,
        totalAmount: p.total_amount,
        telegramChargeId: p.telegram_payment_charge_id,
        providerChargeId: p.provider_payment_charge_id || undefined,
      },
      {
        jobId: `charge-${p.telegram_payment_charge_id}`,
        attempts: 12,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 5000,
        removeOnFail: false,
      },
    );
  });

  // --- Inline-шаринг номера: @bot А777АА77 ---
  bot.on('inline_query', async (ctx) => {
    const t = T[localeOf(ctx.from.language_code)];
    const query = ctx.inlineQuery.query.replace(/^plate\s+/i, '').trim();
    const parsed = parsePlate(query);
    if (!parsed) {
      await ctx.answerInlineQuery([], { cache_time: 5, button: { text: t.shareHint, start_parameter: 'share' } });
      return;
    }
    const key = plateKey(parsed);
    let card;
    try {
      card = await api.plate(key);
    } catch (err) {
      if (err instanceof InternalApiError && err.status === 404) {
        await ctx.answerInlineQuery([], { cache_time: 5, button: { text: t.shareNotFound, start_parameter: 'share' } });
        return;
      }
      throw err;
    }

    const keyboard = new InlineKeyboard().url(t.play, miniAppLink(env, `plate_${key}`));
    const caption = t.shareCaption(card);
    const result: InlineQueryResult = env.PUBLIC_API_URL
      ? {
          type: 'photo',
          id: key,
          photo_url: `${env.PUBLIC_API_URL}/cards/${encodeURIComponent(key)}.png`,
          thumbnail_url: `${env.PUBLIC_API_URL}/cards/${encodeURIComponent(key)}.png`,
          photo_width: 1000,
          photo_height: 500,
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }
      : {
          type: 'article',
          id: key,
          title: t.shareTitle(card),
          input_message_content: { message_text: caption, parse_mode: 'HTML' },
          reply_markup: keyboard,
        };
    await ctx.answerInlineQuery([result], { cache_time: 30 });
  });

  bot.catch((err) => {
    console.error(`Ошибка при обработке update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}
