import { Worker } from 'bullmq';
import { GrammyError, InlineKeyboard, type Bot } from 'grammy';
import type { Redis } from 'ioredis';
import { NOTIFICATION_QUEUE, PAYMENT_QUEUE, type NotificationJob, type PaymentJob } from '@nomer/shared';
import { miniAppLink } from './bot';
import type { Env } from './env';
import { InternalApiError, type InternalApi } from './internal-api';
import { T, renderNotification } from './texts';

/**
 * Воркеры очередей:
 * - notifications — уведомления от API (лимит ~25 сообщений/с, ниже лимитов Telegram);
 * - payments — подтверждение оплат Stars в API с повторами.
 */
export function startWorkers(env: Env, bot: Bot, api: InternalApi, connection: Redis) {
  const notifications = new Worker<NotificationJob>(
    NOTIFICATION_QUEUE,
    async (job) => {
      const { text, startParam } = renderNotification(job.data);
      const t = T[job.data.locale === 'en' ? 'en' : 'ru'];
      try {
        await bot.api.sendMessage(job.data.telegramId, text, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().url(t.open, miniAppLink(env, startParam)),
        });
      } catch (err) {
        // 403 — пользователь заблокировал бота: повторять бессмысленно.
        if (err instanceof GrammyError && err.error_code === 403) {
          await api.setBlocked(job.data.telegramId, true).catch(() => {});
          return;
        }
        throw err;
      }
    },
    { connection, concurrency: 5, limiter: { max: 25, duration: 1000 } },
  );

  const payments = new Worker<PaymentJob>(
    PAYMENT_QUEUE,
    async (job) => {
      const { chatId, locale, ...payment } = job.data;
      try {
        const res = await api.confirmPayment(payment);
        if (!res.duplicate) {
          const text = res.refunded ? T[locale].refunded : res.kind === 'rolls' ? T[locale].paid(res.rolls) : T[locale].paidItem;
          await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      } catch (err) {
        // 400 — платёж не сходится с заказом: повтор не поможет, нужен ручной разбор (см. лог API).
        if (err instanceof InternalApiError && err.status === 400) {
          console.error('Платёж требует ручного разбора', job.data, err.message);
          return;
        }
        throw err;
      }
    },
    { connection, concurrency: 2 },
  );

  for (const w of [notifications, payments]) {
    w.on('failed', (job, err) => console.error(`[${w.name}] job ${job?.id} failed:`, err.message));
  }
  return [notifications, payments];
}
