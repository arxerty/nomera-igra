import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parse } from '../lib/validate';
import { currentUser } from '../plugins/auth';
import {
  adjustBalance,
  adjustSchema,
  auditQuerySchema,
  auditUser,
  getUserForAdmin,
  patchConfig,
  rebuildLeaderboards,
  recomputePlates,
} from '../services/admin';

const tgParam = z.object({ telegramId: z.string().regex(/^\d{1,20}$/) });

/**
 * Админ-эндпоинты (/api/admin/*). Доступ — только Telegram ID из ADMIN_TELEGRAM_IDS.
 * Шансы, VIP-серии, регионы и цены правятся через PATCH /config, например:
 *   { "odds": { "mythic": 1000 } }
 *   { "rarity": { "vipSeries": [{ "letters": "ЕКХ" }] } }
 *   { "regions": ["77", "78", "50"] }
 *   { "prices": { "base": { ... } } }
 */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/config', async () => ctx.config.get());

  app.get('/config/history', async () => {
    const rows = await ctx.config.history();
    return rows.map((r) => ({ ...r, createdBy: r.createdBy?.toString() ?? null }));
  });

  /** Полная замена конфига. */
  app.put('/config', async (req) => ctx.config.save(req.body, currentUser(req).telegramId));

  /** Частичная правка секций конфига. */
  app.patch('/config', async (req) => patchConfig(ctx, currentUser(req).telegramId, req.body));

  /** Пересчёт редкости и ценности всех номеров по текущему конфигу. */
  app.post('/recompute', async () => recomputePlates(ctx));

  app.post('/leaderboards/rebuild', async () => {
    await rebuildLeaderboards(ctx);
    return { ok: true };
  });

  app.get('/users/:telegramId', async (req) => getUserForAdmin(ctx, parse(tgParam, req.params).telegramId));

  app.get('/users/:telegramId/audit', async (req) => {
    const rows = await auditUser(ctx, parse(tgParam, req.params).telegramId, parse(auditQuerySchema, req.query));
    return rows;
  });

  app.post('/users/:telegramId/adjust', async (req) => {
    const { telegramId } = parse(tgParam, req.params);
    return adjustBalance(ctx, currentUser(req).telegramId, telegramId, parse(adjustSchema, req.body));
  });
}
