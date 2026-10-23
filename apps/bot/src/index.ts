import { createServer } from 'node:http';
import { Queue } from 'bullmq';
import { webhookCallback } from 'grammy';
import { Redis } from 'ioredis';
import { PAYMENT_QUEUE, type PaymentJob } from '@nomer/shared';
import { createBot } from './bot';
import { loadEnv } from './env';
import { createInternalApi } from './internal-api';
import { T } from './texts';
import { startWorkers } from './workers';

const env = loadEnv();
// BullMQ требует maxRetriesPerRequest: null для воркеров.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const payments = new Queue<PaymentJob>(PAYMENT_QUEUE, { connection });
const api = createInternalApi(env);
const bot = createBot(env, api, payments);
const workers = startWorkers(env, bot, api, connection);

const ALLOWED_UPDATES = ['message', 'inline_query', 'pre_checkout_query'] as const;

// Кнопка меню чата открывает Mini App; команды — в меню «/».
await bot.api.setChatMenuButton({
  menu_button: { type: 'web_app', text: T.ru.play.replace(/^\S+\s/, ''), web_app: { url: env.WEB_APP_URL } },
});
await bot.api.setMyCommands([
  { command: 'start', description: 'Открыть игру' },
  { command: 'help', description: 'Помощь' },
  { command: 'paysupport', description: 'Помощь с оплатой' },
]);
await bot.api.setMyCommands(
  [
    { command: 'start', description: 'Open the game' },
    { command: 'help', description: 'Help' },
    { command: 'paysupport', description: 'Payment support' },
  ],
  { language_code: 'en' },
);

let server: ReturnType<typeof createServer> | null = null;
if (env.BOT_WEBHOOK_URL) {
  const handle = webhookCallback(bot, 'http', { secretToken: env.BOT_WEBHOOK_SECRET });
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/telegram') return void handle(req, res);
    res.statusCode = req.url === '/health' ? 200 : 404;
    res.end();
  });
  server.listen(env.BOT_PORT, () => console.log(`Webhook-сервер бота на порту ${env.BOT_PORT}`));
  await bot.api.setWebhook(env.BOT_WEBHOOK_URL, {
    secret_token: env.BOT_WEBHOOK_SECRET,
    allowed_updates: [...ALLOWED_UPDATES],
  });
} else {
  await bot.api.deleteWebhook();
  void bot.start({
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: (me) => console.log(`Бот @${me.username} запущен (long polling)`),
  });
}

async function shutdown() {
  await bot.stop().catch(() => {});
  server?.close();
  await Promise.all(workers.map((w) => w.close()));
  await payments.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
