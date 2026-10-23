import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CarsConfigDto } from '@nomer/shared';
import type { AppContext } from '../context';
import { hitRateLimit } from '../lib/rate-limit';
import { parse } from '../lib/validate';
import { currentUser } from '../plugins/auth';
import { buyCarListing, cancelCarListing, carMarketQuerySchema, createCarListing, searchCarListings } from '../services/car-market';
import {
  carCard,
  listMyCars,
  listUserCars,
  mountPlate,
  sellCarToSystem,
  tuneCar,
  tuningSchema,
  unmountPlate,
} from '../services/cars';
import { createItemInvoice, itemInvoiceSchema } from '../services/payments';
import { buyCar, buyCarSchema, buyGarageSlot, getShowroom } from '../services/showroom';
import { collectTrips, startTrip } from '../services/trips';

const idParam = z.object({ id: z.string().min(1) });

/** Лимит на операции с машинами, меняющие имущество или баланс. */
const CARS_LIMIT = { max: 60, windowSec: 60 };

/** Автосалон, гараж машин, номера на машинах, тюнинг, покатушки, рынок машин. Все роуты — под авторизацией. */
export async function carRoutes(app: FastifyInstance, ctx: AppContext) {
  const limit = (userId: string) => hitRateLimit(ctx.redis, 'cars', userId, CARS_LIMIT.max, CARS_LIMIT.windowSec);

  app.get('/cars/config', async (): Promise<CarsConfigDto> => {
    const { cars, races, auction, exhibition, clubs, dreamSearch } = (await ctx.config.get()).config;
    return { cars, races, auction, exhibition, clubs, dreamSearch };
  });

  // --- Автосалон ---
  app.get('/showroom', async (req) => getShowroom(ctx, currentUser(req).id));

  app.post('/showroom/:id/buy', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return buyCar(ctx, user.id, parse(idParam, req.params).id, parse(buyCarSchema, req.body ?? {}).color);
  });

  app.post('/garage/slots/buy', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return buyGarageSlot(ctx, user.id);
  });

  app.post('/payments/item-invoice', async (req) => {
    const user = currentUser(req);
    await hitRateLimit(ctx.redis, 'invoice', user.id, 10, 60);
    return createItemInvoice(ctx, user, parse(itemInvoiceSchema, req.body));
  });

  // --- Гараж машин ---
  app.get('/cars', async (req) => listMyCars(ctx, currentUser(req).id));
  app.get('/users/:id/cars', async (req) => listUserCars(ctx, currentUser(req), parse(idParam, req.params).id));
  app.get('/cars/:id', async (req) => carCard(ctx, currentUser(req), parse(idParam, req.params).id));

  app.post('/cars/:id/plate', async (req) => {
    const user = currentUser(req);
    const { plateId } = parse(z.object({ plateId: z.string().min(1) }), req.body);
    await limit(user.id);
    return mountPlate(ctx, user.id, parse(idParam, req.params).id, plateId);
  });

  app.delete('/cars/:id/plate', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return unmountPlate(ctx, user.id, parse(idParam, req.params).id);
  });

  app.put('/cars/:id/tuning', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return tuneCar(ctx, user.id, parse(idParam, req.params).id, parse(tuningSchema, req.body));
  });

  app.post('/cars/:id/sell', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return sellCarToSystem(ctx, user.id, parse(idParam, req.params).id);
  });

  // --- Покатушки ---
  app.post('/cars/:id/trips', async (req) => {
    const user = currentUser(req);
    const { hours } = parse(z.object({ hours: z.number().int() }), req.body);
    await limit(user.id);
    return startTrip(ctx, user.id, parse(idParam, req.params).id, hours);
  });

  app.post('/trips/collect', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return collectTrips(ctx, user.id);
  });

  // --- Рынок машин ---
  app.get('/car-market', async (req) => searchCarListings(ctx, currentUser(req), parse(carMarketQuerySchema, req.query)));

  app.post('/car-market/listings', async (req) => {
    const user = currentUser(req);
    const body = parse(z.object({ carId: z.string().min(1), price: z.number().int() }), req.body);
    await limit(user.id);
    return createCarListing(ctx, user, body.carId, body.price);
  });

  app.delete('/car-market/listings/:id', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    await cancelCarListing(ctx, user.id, parse(idParam, req.params).id);
    return { ok: true };
  });

  app.post('/car-market/listings/:id/buy', async (req) => {
    const user = currentUser(req);
    await limit(user.id);
    return buyCarListing(ctx, user.id, parse(idParam, req.params).id);
  });
}
