import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACHIEVEMENT_IDS } from '@nomer/shared';
import type { AppContext } from '../context';
import { hitCooldown, hitRateLimit } from '../lib/rate-limit';
import { parse } from '../lib/validate';
import { currentUser } from '../plugins/auth';
import { setTitle, syncAchievements } from '../services/achievements';
import { getAuction, placeBid } from '../services/auction';
import {
  createClub,
  createClubSchema,
  getClub,
  joinClub,
  kickMember,
  leaveClub,
  listClubs,
  myClub,
  updateClubChat,
} from '../services/clubs';
import { addDreamMask, deleteDreamMask, listDreamMasks } from '../services/dream';
import { enterExhibition, getExhibition, getVotePair, vote } from '../services/exhibition';
import { enterRaceQueue, getRaceQueue, leaveRaceQueue, pollRaceQueue, raceHistory } from '../services/races';

const idParam = z.object({ id: z.string().min(1) });

/** Гонки, аукцион, выставка, клубы, «номер мечты», ачивки. Все роуты — под авторизацией. */
export async function arenaRoutes(app: FastifyInstance, ctx: AppContext) {
  const limit = (name: string, userId: string, max = 30) => hitRateLimit(ctx.redis, name, userId, max, 60);

  // --- Гонки ---
  app.get('/races/queue', async (req) => getRaceQueue(ctx, currentUser(req).id));

  app.post('/races/queue', async (req) => {
    const user = currentUser(req);
    const body = parse(z.object({ carId: z.string().min(1), bet: z.number().int().min(0).default(0) }), req.body);
    await hitCooldown(ctx.redis, 'race', user.id, 1_000);
    return enterRaceQueue(ctx, user.id, body.carId, body.bet);
  });

  app.post('/races/queue/poll', async (req) => {
    const user = currentUser(req);
    await limit('race_poll', user.id, 60);
    return pollRaceQueue(ctx, user.id);
  });

  app.delete('/races/queue', async (req) => leaveRaceQueue(ctx, currentUser(req).id));

  app.get('/races/history', async (req) => {
    const { limit: take } = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
    return raceHistory(ctx, currentUser(req).id, take);
  });

  // --- Аукцион ---
  app.get('/auction', async (req) => ({ auction: await getAuction(ctx, currentUser(req).id) }));

  app.post('/auction/:id/bids', async (req) => {
    const user = currentUser(req);
    const { amount } = parse(z.object({ amount: z.number().int().min(1) }), req.body);
    await limit('bid', user.id);
    return placeBid(ctx, user.id, parse(idParam, req.params).id, amount);
  });

  // --- Автовыставка ---
  app.get('/exhibition', async (req) => getExhibition(ctx, currentUser(req)));

  app.post('/exhibition/entries', async (req) => {
    const { carId } = parse(z.object({ carId: z.string().min(1) }), req.body);
    return enterExhibition(ctx, currentUser(req), carId);
  });

  app.get('/exhibition/pair', async (req) => {
    const user = currentUser(req);
    await limit('exh_pair', user.id, 120);
    return getVotePair(ctx, user);
  });

  app.post('/exhibition/votes', async (req) => {
    const user = currentUser(req);
    const { winnerEntryId } = parse(z.object({ winnerEntryId: z.string().min(1) }), req.body);
    await limit('exh_vote', user.id, 60);
    return vote(ctx, user, winnerEntryId);
  });

  // --- Клубы ---
  app.get('/clubs', async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    return listClubs(ctx, q.limit);
  });
  app.get('/clubs/mine', async (req) => ({ club: await myClub(ctx, currentUser(req).id) }));
  app.get('/clubs/:id', async (req) => getClub(ctx, currentUser(req).id, parse(idParam, req.params).id));

  app.post('/clubs', async (req) => {
    const user = currentUser(req);
    await limit('clubs', user.id, 10);
    return createClub(ctx, user.id, parse(createClubSchema, req.body));
  });
  app.post('/clubs/:id/join', async (req) => {
    const user = currentUser(req);
    await limit('clubs', user.id, 10);
    return joinClub(ctx, user.id, parse(idParam, req.params).id);
  });
  app.post('/clubs/leave', async (req) => {
    await leaveClub(ctx, currentUser(req).id);
    return { ok: true };
  });
  app.patch('/clubs/mine', async (req) => {
    const { chatLink } = parse(z.object({ chatLink: z.string().max(200).nullable() }), req.body);
    return updateClubChat(ctx, currentUser(req).id, chatLink);
  });
  app.delete('/clubs/mine/members/:id', async (req) =>
    kickMember(ctx, currentUser(req).id, parse(idParam, req.params).id),
  );

  // --- Номер мечты ---
  app.get('/dream-masks', async (req) => listDreamMasks(ctx, currentUser(req).id));
  app.post('/dream-masks', async (req) => {
    const user = currentUser(req);
    const { mask } = parse(z.object({ mask: z.string().max(16) }), req.body);
    await limit('dream', user.id, 20);
    return addDreamMask(ctx, user.id, mask);
  });
  app.delete('/dream-masks/:id', async (req) => {
    await deleteDreamMask(ctx, currentUser(req).id, parse(idParam, req.params).id);
    return { ok: true };
  });

  // --- Ачивки и титул ---
  app.get('/achievements', async (req) => syncAchievements(ctx, currentUser(req).id));
  app.put('/profile/title', async (req) => {
    const { title } = parse(z.object({ title: z.enum(ACHIEVEMENT_IDS).nullable() }), req.body);
    return setTitle(ctx, currentUser(req).id, title);
  });
}
