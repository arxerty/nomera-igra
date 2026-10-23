import { Resvg } from '@resvg/resvg-js';
import type { FastifyInstance } from 'fastify';
import { TIER_COLORS, renderPlateCardSvg } from '@nomer/shared';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { hitRateLimit } from '../lib/rate-limit';

const MAX_CACHE = 500;

/**
 * PNG-карточки номеров для inline-шаринга в Telegram: GET /cards/А777АА77.png.
 * Отдаются только существующие в игре номера; результат кешируется в памяти.
 */
export async function cardRoutes(app: FastifyInstance, ctx: AppContext) {
  const cache = new Map<string, Buffer>();

  app.get('/cards/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const key = decodeURIComponent(file).replace(/\.png$/i, '');
    if (key === file || key.length > 12) throw notFound();
    await hitRateLimit(ctx.redis, 'cards', req.ip, 120, 60);

    const plate = await ctx.prisma.plate.findUnique({ where: { key } });
    if (!plate) throw notFound('Номер не найден');

    const cacheKey = `${key}:${plate.tier}`;
    let png = cache.get(cacheKey);
    if (!png) {
      const svg = renderPlateCardSvg(plate, TIER_COLORS[plate.tier]);
      png = new Resvg(svg, { fitTo: { mode: 'width', value: 1000 } }).render().asPng();
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, png);
    }
    return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=3600').send(png);
  });
}
