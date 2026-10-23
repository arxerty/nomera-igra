import type { FastifyInstance } from 'fastify';
import { TIERS, oddsAsPercent, type OddsDto } from '@nomer/shared';
import type { AppContext } from '../context';
import { hitRateLimit } from '../lib/rate-limit';
import { readInitData } from '../plugins/auth';
import { getMe, loginWithInitData } from '../services/users';

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/health', async () => ({ ok: true }));

  /** Вход: Authorization: tma <initData>. Создаёт игрока при первом входе. */
  app.post('/api/auth', async (req) => {
    await hitRateLimit(ctx.redis, 'auth', req.ip, 30, 60);
    const data = readInitData(ctx, req.headers.authorization);
    const user = await loginWithInitData(ctx, data);
    return getMe(ctx, user);
  });

  /** Экран «Шансы»: публичный. */
  app.get('/api/odds', async (): Promise<OddsDto> => {
    const { config } = await ctx.config.get();
    const pct = oddsAsPercent(config.odds);
    return {
      tiers: TIERS.map((tier) => ({ tier, percent: pct[tier], price: config.prices.base[tier] })),
      bonusMultipliers: config.prices.bonusMultipliers,
      vipSeries: config.rarity.vipSeries,
      mythicNumbers: config.rarity.mythicNumbers,
      capitalRegions: config.rarity.capitalRegions,
    };
  });
}
