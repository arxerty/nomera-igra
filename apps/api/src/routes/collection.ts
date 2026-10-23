import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { hitRateLimit } from '../lib/rate-limit';
import { parse } from '../lib/validate';
import { currentUser } from '../plugins/auth';
import { garageQuerySchema, garageSummary, listGarage, plateCard, sellToSystem } from '../services/garage';
import { buyListing, cancelListing, createListing, marketQuerySchema, searchListings } from '../services/market';
import { acceptOffer, closeOffer, createOffer, createOfferSchema, getOffer, listOffers } from '../services/trades';

const idParam = z.object({ id: z.string().min(1) });
const codeParam = z.object({ code: z.string().min(1).max(32) });

/** Лимит на рыночные и обменные операции, меняющие имущество. */
const MARKET_LIMIT = { max: 30, windowSec: 60 };

/** Гараж, рынок, обмены. Все роуты — под авторизацией. */
export async function collectionRoutes(app: FastifyInstance, ctx: AppContext) {
  const marketLimit = (userId: string) =>
    hitRateLimit(ctx.redis, 'market', userId, MARKET_LIMIT.max, MARKET_LIMIT.windowSec);

  // --- Гараж ---
  app.get('/garage', async (req) => listGarage(ctx, currentUser(req).id, parse(garageQuerySchema, req.query)));
  app.get('/garage/summary', async (req) => garageSummary(ctx, currentUser(req).id));

  /** Гараж другого игрока (из рейтинга). */
  app.get('/users/:id/garage', async (req) => {
    const { id } = parse(idParam, req.params);
    return listGarage(ctx, id, parse(garageQuerySchema, req.query));
  });

  /** Карточка номера по id или ключу ("А123ВС77"). */
  app.get('/plates/:id', async (req) => plateCard(ctx, parse(idParam, req.params).id));

  app.post('/plates/:id/sell', async (req) => {
    const user = currentUser(req);
    await marketLimit(user.id);
    return sellToSystem(ctx, user.id, parse(idParam, req.params).id);
  });

  // --- Рынок ---
  app.get('/market', async (req) => searchListings(ctx, currentUser(req).id, parse(marketQuerySchema, req.query)));

  app.post('/market/listings', async (req) => {
    const user = currentUser(req);
    const body = parse(z.object({ plateId: z.string(), price: z.number().int() }), req.body);
    await marketLimit(user.id);
    return createListing(ctx, user.id, body.plateId, body.price);
  });

  app.delete('/market/listings/:id', async (req) => {
    const user = currentUser(req);
    await marketLimit(user.id);
    await cancelListing(ctx, user.id, parse(idParam, req.params).id);
    return { ok: true };
  });

  app.post('/market/listings/:id/buy', async (req) => {
    const user = currentUser(req);
    await marketLimit(user.id);
    return buyListing(ctx, user.id, parse(idParam, req.params).id);
  });

  // --- Обмены ---
  app.get('/trades', async (req) => listOffers(ctx, currentUser(req).id));

  app.post('/trades', async (req) => {
    const user = currentUser(req);
    await marketLimit(user.id);
    return createOffer(ctx, user.id, parse(createOfferSchema, req.body));
  });

  app.get('/trades/:code', async (req) => getOffer(ctx, currentUser(req).id, parse(codeParam, req.params).code));

  app.post('/trades/:code/accept', async (req) => {
    const user = currentUser(req);
    await marketLimit(user.id);
    return acceptOffer(ctx, user.id, parse(codeParam, req.params).code);
  });

  app.post('/trades/:code/decline', async (req) => {
    await closeOffer(ctx, currentUser(req).id, parse(codeParam, req.params).code, 'decline');
    return { ok: true };
  });

  app.post('/trades/:code/cancel', async (req) => {
    await closeOffer(ctx, currentUser(req).id, parse(codeParam, req.params).code, 'cancel');
    return { ok: true };
  });
}
