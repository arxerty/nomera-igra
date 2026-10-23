import type { User } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Locale, NotificationJob } from '@nomer/shared';

type Payload = NotificationJob extends infer J
  ? J extends NotificationJob
    ? Omit<J, 'telegramId' | 'locale'>
    : never
  : never;

type Recipient = Pick<User, 'telegramId' | 'locale' | 'notificationsEnabled' | 'botBlocked'>;

/** Кладёт уведомления в очередь; отправляет их бот. Сбой очереди не ломает игровую операцию. */
export class Notifier {
  constructor(
    private readonly queue: Queue<NotificationJob>,
    private readonly log: FastifyBaseLogger,
  ) {}

  async send(to: Recipient, payload: Payload, opts: { delayMs?: number; jobId?: string } = {}): Promise<void> {
    if (!to.notificationsEnabled || to.botBlocked) return;
    const job = { ...payload, telegramId: to.telegramId.toString(), locale: to.locale as Locale } as NotificationJob;
    try {
      await this.queue.add(job.type, job, {
        delay: opts.delayMs,
        jobId: opts.jobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      });
    } catch (err) {
      this.log.error({ err, type: job.type }, 'Не удалось поставить уведомление в очередь');
    }
  }
}
