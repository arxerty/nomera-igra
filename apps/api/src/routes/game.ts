import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEADERBOARDS } from '@nomer/shared';
import type { AppContext } from '../context';
import { hitCooldown, hitRateLimit } from '../lib/rate-limit';
import { parse } from '../lib/validate';
import { currentUser } from '../plugins/auth';
import { createInvoice } from '../services/payments';
import { getLeaderboard, getProfile, settingsSchema, updateSettings } from '../services/profile';
import { claimDaily, claimQuest, getQuests } from '../services/quests';
import { buyRollsWithChips, performRoll } from '../services/roll';
import { getMe } from '../services/users';

/** Главная, выбивание, бонусы, задания, рейтинг, профиль. Все роуты — под авторизацией. */
export async function gameRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/me', async (req) => getMe(ctx, currentUser(req)));

  app.post('/roll', async (req) => {
    const user = currentUser(req);
    // Анимация на клиенте идёт ~3 с: кулдаун отсекает автокликеры и двойные нажатия.
    await hitCooldown(ctx.redis, 'roll', user.id, 1_500);
    await hitRateLimit(ctx.redis, 'roll', user.id, 25, 60);
    return performRoll(ctx, user.id);
  });

  app.post('/rolls/buy', async (req) => {
    const user = currentUser(req);
    const { count } = parse(z.object({ count: z.number().int() }), req.body);
    await hitRateLimit(ctx.redis, 'buy_rolls', user.id, 20, 60);
    return buyRollsWithChips(ctx, user.id, count);
  });

  app.post('/payments/invoice', async (req) => {
    const user = currentUser(req);
    const { packId } = parse(z.object({ packId: z.string() }), req.body);
    await hitRateLimit(ctx.redis, 'invoice', user.id, 10, 60);
    return createInvoice(ctx, user, packId);
  });

  app.post('/daily/claim', async (req) => claimDaily(ctx, currentUser(req).id));

  app.get('/quests', async (req) => getQuests(ctx, currentUser(req)));

  app.post('/quests/:id/claim', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return claimQuest(ctx, currentUser(req).id, id);
  });

  app.get('/leaderboard', async (req) => {
    const q = parse(
      z.object({
        board: z.enum(LEADERBOARDS).default('value'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query,
    );
    return getLeaderboard(ctx, currentUser(req).id, q.board, q.limit);
  });

  app.get('/profile', async (req) => getProfile(ctx, currentUser(req)));

  app.patch('/profile/settings', async (req) => {
    return updateSettings(ctx, currentUser(req).id, parse(settingsSchema, req.body));
  });
}
