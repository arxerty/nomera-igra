import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, type ListingDto, type MeDto, type RollResultDto, type TradeOfferDto } from '@nomer/shared';
import { performRoll } from '../../src/services/roll';
import { ADMIN_TG_ID, INTEGRATION, createHarness, type Harness } from './harness';

const { economy } = DEFAULT_GAME_CONFIG;

describe.skipIf(!INTEGRATION)('API (интеграция с Postgres и Redis)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  async function roll(headers: Record<string, string>) {
    await h.clearCooldowns();
    return h.app.inject({ method: 'POST', url: '/api/roll', headers });
  }

  describe('авторизация', () => {
    it('без подписи — 401, с подписью — стартовые баланс и попытки', async () => {
      const bad = await h.app.inject({ method: 'POST', url: '/api/auth', headers: { authorization: 'tma user=1&hash=00' } });
      expect(bad.statusCode).toBe(401);

      const { headers } = await h.login(100);
      const me = (await h.app.inject({ method: 'GET', url: '/api/me', headers })).json<MeDto>();
      expect(me.chips).toBe(economy.startingChips);
      expect(me.rolls).toBe(economy.startingRolls);
      expect(me.freeRollAt).toBeNull();
    });

    it('реферал начисляет бонус пригласившему', async () => {
      const { user: referrer } = await h.login(200);
      await h.login(201, { startParam: 'ref_200' });
      const after = await h.prisma.user.findUniqueOrThrow({ where: { id: referrer.id } });
      expect(after.chips).toBe(economy.startingChips + economy.referralRewardChips);
      expect(h.sent.some((j) => j.type === 'referral_joined' && j.telegramId === '200')).toBe(true);
    });
  });

  describe('выбивание', () => {
    it('сначала бесплатная попытка, потом баланс, потом 409', async () => {
      const { headers, user } = await h.login(300);
      await h.setBalance(user, { rolls: 1 });

      const first = (await roll(headers)).json<RollResultDto>();
      expect(first.source).toBe('free');
      expect(first.freeRollAt).not.toBeNull();
      expect(h.sent.some((j) => j.type === 'free_roll_ready')).toBe(true);

      const second = (await roll(headers)).json<RollResultDto>();
      expect(second.source).toBe('balance');
      expect(second.rolls).toBe(0);

      const third = await roll(headers);
      expect(third.statusCode).toBe(409);
      expect(third.json().error.code).toBe('no_rolls');

      const plates = await h.prisma.plate.findMany({ where: { ownerId: user.id } });
      expect(plates).toHaveLength(2);
      expect(await h.prisma.rollLog.count({ where: { userId: user.id } })).toBe(2);
      expect(await h.prisma.plateOwnership.count({ where: { userId: user.id } })).toBe(2);
    });

    it('кулдаун отсекает повторное нажатие', async () => {
      const { headers, user } = await h.login(301);
      await h.setBalance(user, { rolls: 5 });
      await h.clearCooldowns();
      const [a, b] = await Promise.all([
        h.app.inject({ method: 'POST', url: '/api/roll', headers }),
        h.app.inject({ method: 'POST', url: '/api/roll', headers }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
    });

    it('параллельные выбивания не уводят баланс в минус', async () => {
      const { user } = await h.login(302);
      await h.setBalance(user, { rolls: 3, lastFreeRollAt: new Date() });
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => performRoll(h.ctx, user.id)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.rolls).toBe(0);
      expect(await h.prisma.plate.count({ where: { ownerId: user.id } })).toBe(3);
    });
  });

  describe('рынок', () => {
    async function sellerWithPlate() {
      const seller = await h.login(400, { firstName: 'Продавец' });
      const rolled = (await roll(seller.headers)).json<RollResultDto>();
      return { seller, plateId: rolled.plate.id };
    }

    it('покупка: деньги, комиссия, владелец, паспорт, уведомление', async () => {
      const { seller, plateId } = await sellerWithPlate();
      const buyer = await h.login(401);
      const price = 200;

      const listing = (
        await h.app.inject({ method: 'POST', url: '/api/market/listings', headers: seller.headers, payload: { plateId, price } })
      ).json<ListingDto>();

      const again = await h.app.inject({ method: 'POST', url: '/api/market/listings', headers: seller.headers, payload: { plateId, price } });
      expect(again.json().error.code).toBe('plate_listed');

      const sellListed = await h.app.inject({ method: 'POST', url: `/api/plates/${plateId}/sell`, headers: seller.headers });
      expect(sellListed.json().error.code).toBe('plate_listed');

      const buy = await h.app.inject({ method: 'POST', url: `/api/market/listings/${listing.id}/buy`, headers: buyer.headers });
      expect(buy.statusCode).toBe(200);

      const fee = Math.floor((price * economy.marketFeePercent) / 100);
      const [s, b, plate] = await Promise.all([
        h.prisma.user.findUniqueOrThrow({ where: { id: seller.user.id } }),
        h.prisma.user.findUniqueOrThrow({ where: { id: buyer.user.id } }),
        h.prisma.plate.findUniqueOrThrow({ where: { id: plateId }, include: { ownerships: true } }),
      ]);
      expect(s.chips).toBe(economy.startingChips + price - fee);
      expect(b.chips).toBe(economy.startingChips - price);
      expect(plate.ownerId).toBe(buyer.user.id);
      expect(plate.ownerships).toHaveLength(2);
      expect(h.sent.some((j) => j.type === 'plate_sold' && j.telegramId === '400')).toBe(true);
      expect(await h.prisma.dealLog.count({ where: { type: 'market_sale' } })).toBe(1);
    });

    it('два одновременных покупателя: купит только один', async () => {
      const { seller, plateId } = await sellerWithPlate();
      const [b1, b2] = await Promise.all([h.login(402), h.login(403)]);
      const listing = (
        await h.app.inject({ method: 'POST', url: '/api/market/listings', headers: seller.headers, payload: { plateId, price: 100 } })
      ).json<ListingDto>();

      const results = await Promise.all(
        [b1, b2].map((b) => h.app.inject({ method: 'POST', url: `/api/market/listings/${listing.id}/buy`, headers: b.headers })),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);

      const chips = await h.prisma.user.findMany({ where: { id: { in: [b1.user.id, b2.user.id] } }, select: { chips: true } });
      expect(chips.map((c) => c.chips).sort((a, b) => a - b)).toEqual([economy.startingChips - 100, economy.startingChips]);
    });

    it('нельзя купить без денег и свой лот', async () => {
      const { seller, plateId } = await sellerWithPlate();
      const buyer = await h.login(404);
      await h.setBalance(buyer.user, { chips: 10 });
      const listing = (
        await h.app.inject({ method: 'POST', url: '/api/market/listings', headers: seller.headers, payload: { plateId, price: 500 } })
      ).json<ListingDto>();

      const poor = await h.app.inject({ method: 'POST', url: `/api/market/listings/${listing.id}/buy`, headers: buyer.headers });
      expect(poor.json().error.code).toBe('insufficient_funds');
      const own = await h.app.inject({ method: 'POST', url: `/api/market/listings/${listing.id}/buy`, headers: seller.headers });
      expect(own.json().error.code).toBe('own_listing');
      expect((await h.prisma.plate.findUniqueOrThrow({ where: { id: plateId } })).ownerId).toBe(seller.user.id);
    });

    it('поиск по маске', async () => {
      const { seller, plateId } = await sellerWithPlate();
      const plate = await h.prisma.plate.findUniqueOrThrow({ where: { id: plateId } });
      await h.app.inject({ method: 'POST', url: '/api/market/listings', headers: seller.headers, payload: { plateId, price: 100 } });

      const digits = String(plate.number).padStart(3, '0');
      const hit = await h.app.inject({ method: 'GET', url: `/api/market?mask=${encodeURIComponent(`*${digits}** ${plate.region}`)}`, headers: seller.headers });
      expect(hit.json().items).toHaveLength(1);
      const miss = await h.app.inject({ method: 'GET', url: `/api/market?mask=${encodeURIComponent('*000**')}`, headers: seller.headers });
      expect(miss.json().items).toHaveLength(0);
    });
  });

  describe('продажа системе', () => {
    it('номер возвращается в пул, паспорт сохраняется', async () => {
      const { headers, user } = await h.login(500);
      const rolled = (await roll(headers)).json<RollResultDto>();
      const res = await h.app.inject({ method: 'POST', url: `/api/plates/${rolled.plate.id}/sell`, headers });
      expect(res.json().received).toBe(rolled.plate.value);

      const plate = await h.prisma.plate.findUniqueOrThrow({ where: { id: rolled.plate.id }, include: { ownerships: true } });
      expect(plate.ownerId).toBeNull();
      expect(plate.ownerships[0]!.releasedVia).toBe('system_sell');
      const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.chips).toBe(economy.startingChips + rolled.plate.value);
    });
  });

  describe('обмены', () => {
    it('обмен номер на номер с доплатой', async () => {
      const a = await h.login(600, { firstName: 'Аня' });
      const b = await h.login(601, { firstName: 'Боря' });
      const pa = (await roll(a.headers)).json<RollResultDto>().plate;
      const pb = (await roll(b.headers)).json<RollResultDto>().plate;

      const offer = (
        await h.app.inject({
          method: 'POST',
          url: '/api/trades',
          headers: a.headers,
          payload: { offeredPlateIds: [pa.id], requestedPlateIds: [pb.id], offeredChips: 50 },
        })
      ).json<TradeOfferDto>();
      expect(offer.to?.id).toBe(b.user.id);
      expect(h.sent.some((j) => j.type === 'trade_offer' && j.telegramId === '601')).toBe(true);

      const stranger = await h.login(602);
      const denied = await h.app.inject({ method: 'POST', url: `/api/trades/${offer.code}/accept`, headers: stranger.headers });
      expect(denied.statusCode).toBe(403);

      const ok = await h.app.inject({ method: 'POST', url: `/api/trades/${offer.code}/accept`, headers: b.headers });
      expect(ok.json<TradeOfferDto>().status).toBe('accepted');

      const [plateA, plateB, ua, ub] = await Promise.all([
        h.prisma.plate.findUniqueOrThrow({ where: { id: pa.id } }),
        h.prisma.plate.findUniqueOrThrow({ where: { id: pb.id } }),
        h.prisma.user.findUniqueOrThrow({ where: { id: a.user.id } }),
        h.prisma.user.findUniqueOrThrow({ where: { id: b.user.id } }),
      ]);
      expect(plateA.ownerId).toBe(b.user.id);
      expect(plateB.ownerId).toBe(a.user.id);
      expect(ua.chips).toBe(economy.startingChips - 50);
      expect(ub.chips).toBe(economy.startingChips + 50);

      const twice = await h.app.inject({ method: 'POST', url: `/api/trades/${offer.code}/accept`, headers: b.headers });
      expect(twice.json().error.code).toBe('trade_closed');
    });

    it('предложение не принимается, если номер ушёл другому', async () => {
      const a = await h.login(610);
      const b = await h.login(611);
      const pa = (await roll(a.headers)).json<RollResultDto>().plate;
      const offer = (
        await h.app.inject({ method: 'POST', url: '/api/trades', headers: a.headers, payload: { offeredPlateIds: [pa.id], requestedChips: 10 } })
      ).json<TradeOfferDto>();
      await h.app.inject({ method: 'POST', url: `/api/plates/${pa.id}/sell`, headers: a.headers });

      const res = await h.app.inject({ method: 'POST', url: `/api/trades/${offer.code}/accept`, headers: b.headers });
      expect(res.json().error.code).toBe('trade_invalid');
    });
  });

  describe('бонусы и задания', () => {
    it('ежедневный бонус выдаётся раз в сутки', async () => {
      const { headers } = await h.login(700);
      const first = await h.app.inject({ method: 'POST', url: '/api/daily/claim', headers });
      expect(first.json().reward).toEqual(economy.dailyStreak[0]);
      const second = await h.app.inject({ method: 'POST', url: '/api/daily/claim', headers });
      expect(second.json().error.code).toBe('already_claimed');
    });

    it('задание засчитывается и награда выдаётся один раз', async () => {
      const { headers, user } = await h.login(701);
      await h.setBalance(user, { rolls: 5 });
      for (let i = 0; i < 3; i++) await roll(headers);

      const quests = (await h.app.inject({ method: 'GET', url: '/api/quests', headers })).json();
      expect(quests.quests.find((q: { id: string }) => q.id === 'roll_3').progress).toBe(3);

      const claim = await h.app.inject({ method: 'POST', url: '/api/quests/roll_3/claim', headers });
      expect(claim.statusCode).toBe(200);
      const again = await h.app.inject({ method: 'POST', url: '/api/quests/roll_3/claim', headers });
      expect(again.json().error.code).toBe('already_claimed');
    });
  });

  describe('оплата Stars', () => {
    it('начисляет попытки ровно один раз', async () => {
      const { user } = await h.login(800);
      const payment = await h.prisma.payment.create({ data: { userId: user.id, packId: 'rolls_5', stars: 25, rolls: 5 } });
      const internal = { 'x-internal-token': 'internal-token-for-tests-0123456789' };
      const event = { payload: payment.id, telegramUserId: '800', currency: 'XTR', totalAmount: 25 };

      const wrongAmount = await h.app.inject({ method: 'POST', url: '/internal/payments/pre-checkout', headers: internal, payload: { ...event, totalAmount: 1 } });
      expect(wrongAmount.json().ok).toBe(false);
      const pre = await h.app.inject({ method: 'POST', url: '/internal/payments/pre-checkout', headers: internal, payload: event });
      expect(pre.json().ok).toBe(true);

      const success = { ...event, telegramChargeId: 'charge-1' };
      const r1 = await h.app.inject({ method: 'POST', url: '/internal/payments/success', headers: internal, payload: success });
      const r2 = await h.app.inject({ method: 'POST', url: '/internal/payments/success', headers: internal, payload: success });
      expect(r1.json().duplicate).toBe(false);
      expect(r2.json().duplicate).toBe(true);
      const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.rolls).toBe(economy.startingRolls + 5);

      const noToken = await h.app.inject({ method: 'POST', url: '/internal/payments/success', payload: success });
      expect(noToken.statusCode).toBe(403);
    });
  });

  describe('рейтинг', () => {
    it('своё место и топ по ценности', async () => {
      const a = await h.login(900);
      const b = await h.login(901);
      await roll(a.headers);
      await roll(b.headers);
      const lb = (await h.app.inject({ method: 'GET', url: '/api/leaderboard?board=value', headers: a.headers })).json();
      expect(lb.entries).toHaveLength(2);
      expect(lb.me.rank).toBeGreaterThanOrEqual(1);
      const weekly = (await h.app.inject({ method: 'GET', url: '/api/leaderboard?board=weekly', headers: a.headers })).json();
      expect(weekly.entries).toHaveLength(2);
    });
  });

  describe('админка', () => {
    it('доступна только админам; правка шансов видна на экране «Шансы»', async () => {
      const user = await h.login(1000);
      const admin = await h.login(ADMIN_TG_ID);

      const denied = await h.app.inject({ method: 'GET', url: '/api/admin/config', headers: user.headers });
      expect(denied.statusCode).toBe(403);

      const odds = { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 1 };
      const patched = await h.app.inject({ method: 'PATCH', url: '/api/admin/config', headers: admin.headers, payload: { odds } });
      expect(patched.statusCode).toBe(200);

      const bad = await h.app.inject({ method: 'PATCH', url: '/api/admin/config', headers: admin.headers, payload: { regions: ['1'] } });
      expect(bad.statusCode).toBe(400);

      const pub = (await h.app.inject({ method: 'GET', url: '/api/odds' })).json();
      expect(pub.tiers.find((t: { tier: string }) => t.tier === 'mythic').percent).toBe(50);
    });
  });
});
