import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GAME_CONFIG,
  classifyPlate,
  parsePlate,
  plateBody,
  plateKey,
  plateValue,
  type AuctionDto,
  type CarCardDto,
  type CarDto,
  type CarGarageDto,
  type ClubDto,
  type ExhibitionDto,
  type RaceQueueDto,
  type ShowroomDto,
  type VotePairDto,
} from '@nomer/shared';
import { runScheduledTasks } from '../../src/services/scheduler';
import { ADMIN_TG_ID, INTEGRATION, createHarness, type Harness } from './harness';

const { cars: carsConfig, economy } = DEFAULT_GAME_CONFIG;
const HOUR = 3_600_000;
const INTERNAL = { 'x-internal-token': 'internal-token-for-tests-0123456789' };

describe.skipIf(!INTEGRATION)('Машины (интеграция с Postgres и Redis)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await h.close();
  });

  type Player = Awaited<ReturnType<Harness['login']>>;

  async function player(telegramId: number, chips = 1_000_000): Promise<Player> {
    const p = await h.login(telegramId);
    await h.setBalance(p.user, { chips });
    return p;
  }

  async function chipsOf(p: Player) {
    return (await h.prisma.user.findUniqueOrThrow({ where: { id: p.user.id } })).chips;
  }

  /** Кладёт номер прямо в гараж игрока (минуя выбивание) — чтобы тир был известен заранее. */
  async function givePlate(p: Player, text: string) {
    const plate = parsePlate(text)!;
    const rarity = classifyPlate(plate, DEFAULT_GAME_CONFIG.rarity);
    return h.prisma.plate.create({
      data: {
        key: plateKey(plate),
        body: plateBody(plate),
        letters: plate.letters,
        number: plate.number,
        region: plate.region,
        tier: rarity.tier,
        value: plateValue(rarity, DEFAULT_GAME_CONFIG.prices),
        traits: rarity.traits,
        bonuses: rarity.bonuses,
        ownerId: p.user.id,
        acquiredAt: new Date(),
        ownerships: { create: { userId: p.user.id, acquiredVia: 'roll' } },
      },
    });
  }

  async function buy(p: Player, modelId: string): Promise<CarDto> {
    const r = await h.api<CarDto>(p.headers, 'POST', `/showroom/${modelId}/buy`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  }

  async function mount(p: Player, carId: string, plateId: string) {
    return h.api<CarDto>(p.headers, 'POST', `/cars/${carId}/plate`, { plateId });
  }

  async function patchConfig(patch: object) {
    const admin = await h.login(ADMIN_TG_ID);
    const r = await h.api(admin.headers, 'PATCH', '/admin/config', patch);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }

  describe('салон и гараж', () => {
    it('покупка: деньги, журнал, история, лимит гаража и докупка места', async () => {
      const p = await player(2000, 5_000);
      const showroom = (await h.api<ShowroomDto>(p.headers, 'GET', '/showroom')).body;
      expect(showroom.models.map((m) => m.id)).toContain('zarya_2101');
      expect(showroom.garage).toMatchObject({ used: 0, slots: carsConfig.garage.baseSlots });

      const car = await buy(p, 'zarya_2101');
      expect(car.model.id).toBe('zarya_2101');
      expect(await chipsOf(p)).toBe(5_000 - 1_200);
      expect(await h.prisma.ledgerEntry.count({ where: { userId: p.user.id, reason: 'car_purchase' } })).toBe(1);
      const card = (await h.api<CarCardDto>(p.headers, 'GET', `/cars/${car.id}`)).body;
      expect(card.history).toHaveLength(1);
      expect(card.history[0]!.acquiredVia).toBe('showroom');

      await h.setBalance(p.user, { chips: 1_000_000 });
      await buy(p, 'ladoga_granit');
      await buy(p, 'korsar_sirius');
      const full = await h.api(p.headers, 'POST', '/showroom/zarya_2101/buy', {});
      expect(full.error).toBe('garage_full');

      const slot = await h.api(p.headers, 'POST', '/garage/slots/buy');
      expect(slot.body.garage.slots).toBe(carsConfig.garage.baseSlots + 1);
      expect(await chipsOf(p)).toBe(1_000_000 - 1_800 - 3_500 - carsConfig.garage.slotPriceChips);
      await buy(p, 'zarya_2101');

      const notToday = showroom.models.length;
      expect(notToday).toBeGreaterThan(0);
      expect((await h.api(p.headers, 'POST', '/showroom/nope/buy', {})).status).toBe(404);
    });

    it('модели не из сегодняшней ротации не продаются', async () => {
      const p = await player(2001);
      const today = new Set((await h.api<ShowroomDto>(p.headers, 'GET', '/showroom')).body.models.map((m) => m.id));
      const rotating = await h.prisma.carModel.findMany({ where: { showroom: 'rotating' } });
      const absent = rotating.find((m) => !today.has(m.id))!;
      expect((await h.api(p.headers, 'POST', `/showroom/${absent.id}/buy`, {})).error).toBe('not_in_showroom');
    });

    it('последний экземпляр тиража достаётся только одному', async () => {
      const model = await h.prisma.carModel.update({ where: { id: 'zarya_2101_jubilee' }, data: { sold: 99 } });
      const [a, b] = await Promise.all([player(2010), player(2011)]);
      const results = await Promise.all([a, b].map((p) => h.api<CarDto>(p.headers, 'POST', `/showroom/${model.id}/buy`, {})));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.error).toBe('sold_out');
      expect(results.find((r) => r.status === 200)!.body.serial).toBe(100);

      const showroom = (await h.api<ShowroomDto>(a.headers, 'GET', '/showroom')).body;
      expect(showroom.models.map((m) => m.id)).not.toContain(model.id);
      expect(await h.prisma.userCar.count({ where: { modelId: model.id } })).toBe(1);
    });
  });

  describe('номер на машине', () => {
    it('«Статус», блокировка продажи номера, кулдаун и госпошлина', async () => {
      const p = await player(2100);
      const car = await buy(p, 'derzhava_regent');
      const legendary = await givePlate(p, 'А777АА 50');
      const common = await givePlate(p, 'В245КМ 50');
      expect(legendary.tier).toBe('legendary');

      const mounted = (await mount(p, car.id, legendary.id)).body;
      expect(mounted.combos).toContain('status');
      expect(mounted.value).toBe(car.model.priceChips + Math.round(legendary.value * carsConfig.combos.status.prestige));
      expect(mounted.plate!.carId).toBe(car.id);

      expect((await h.api(p.headers, 'POST', `/plates/${legendary.id}/sell`)).error).toBe('plate_mounted');
      expect((await h.api(p.headers, 'POST', '/market/listings', { plateId: legendary.id, price: 100 })).error).toBe('plate_mounted');
      expect((await h.api(p.headers, 'POST', '/trades', { offeredPlateIds: [legendary.id], requestedChips: 10 })).error).toBe('trade_invalid');

      expect((await mount(p, car.id, common.id)).error).toBe('plate_change_cooldown');
      h.clock.advance(carsConfig.plateMount.cooldownHours * HOUR + 1000);
      const before = await chipsOf(p);
      const swapped = await mount(p, car.id, common.id);
      expect(swapped.status).toBe(200);
      expect(swapped.body.combos).not.toContain('status');
      expect(await chipsOf(p)).toBe(before - carsConfig.plateMount.removeFeeChips);
      expect(await h.prisma.userCar.count({ where: { plateId: legendary.id } })).toBe(0);

      // Рейтинг коллекций: свободный номер + машина с номером и комбо.
      const profile = (await h.api(p.headers, 'GET', '/profile')).body;
      expect(profile.stats.collectionValue).toBe(legendary.value + car.model.priceChips + common.value);
    });

    it('чужой номер и чужую машину трогать нельзя', async () => {
      const a = await player(2110);
      const b = await player(2111);
      const car = await buy(a, 'zarya_2101');
      const plate = await givePlate(b, 'К123МО 77');
      expect((await mount(a, car.id, plate.id)).error).toBe('not_owner');
      expect((await mount(b, car.id, plate.id)).error).toBe('not_owner');
    });

    it('«Мезальянс» даёт ачивку, а титул можно выбрать только полученный', async () => {
      const p = await player(2120);
      const car = await buy(p, 'zarya_2101');
      const mythic = await givePlate(p, 'А777АА 77');
      expect(mythic.tier).toBe('mythic');
      const res = (await mount(p, car.id, mythic.id)).body;
      expect(res.combos).toContain('mesalliance');
      expect(res.badges).toContain('mesalliance');

      const ach = (await h.api(p.headers, 'GET', '/achievements')).body;
      const earned = ach.achievements.filter((a: { earnedAt: string | null }) => a.earnedAt).map((a: { id: string }) => a.id);
      expect(earned).toEqual(expect.arrayContaining(['mesalliance', 'three_sevens']));
      expect((await h.api(p.headers, 'PUT', '/profile/title', { title: 'mesalliance' })).status).toBe(200);
      expect((await h.api(p.headers, 'PUT', '/profile/title', { title: 'track_king' })).status).toBe(403);
    });
  });

  describe('тюнинг', () => {
    it('платится только изменённое, характеристики растут, эксклюзив без выдачи недоступен', async () => {
      const p = await player(2200);
      const car = await buy(p, 'korsar_sirius');
      const before = await chipsOf(p);
      const tuned = await h.api<CarDto>(p.headers, 'PUT', `/cars/${car.id}/tuning`, {
        ...car.tuning,
        engine: 1,
        tint: 1,
      });
      expect(tuned.status, JSON.stringify(tuned.body)).toBe(200);
      expect(tuned.body.stats.speed).toBe(car.stats.speed + carsConfig.tuning.engine.speedPerLevel);
      const engineCost = Math.round(carsConfig.tuning.engine.baseCost * carsConfig.tuning.classCostMultiplier.comfort);
      expect(await chipsOf(p)).toBe(before - engineCost - carsConfig.tuning.tint.costPerLevel);

      const downgrade = await h.api(p.headers, 'PUT', `/cars/${car.id}/tuning`, { ...tuned.body.tuning, engine: 0 });
      expect(downgrade.error).toBe('tuning_invalid');
      const exclusive = await h.api(p.headers, 'PUT', `/cars/${car.id}/tuning`, {
        ...tuned.body.tuning,
        paint: { finish: 'exclusive', color: 'tournament_gold' },
      });
      expect(exclusive.error).toBe('tuning_invalid');
    });
  });

  describe('покатушки', () => {
    it('без номера нельзя, машина занята в пути, доход забирается после возвращения', async () => {
      const p = await player(2300);
      const car = await buy(p, 'falke_fuenf');
      expect((await h.api(p.headers, 'POST', `/cars/${car.id}/trips`, { hours: 4 })).error).toBe('no_plate');

      const plate = await givePlate(p, 'Е555КХ 50');
      await mount(p, car.id, plate.id);
      expect((await h.api(p.headers, 'POST', `/cars/${car.id}/trips`, { hours: 3 })).status).toBe(400);
      const started = await h.api<CarDto>(p.headers, 'POST', `/cars/${car.id}/trips`, { hours: 4 });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      expect(started.body.busy).toBe('trip');
      expect(started.body.trip!.income).toBeNull();
      expect(h.sent.some((j) => j.type === 'trip_returned')).toBe(true);
      const quests = (await h.api(p.headers, 'GET', '/quests')).body.quests;
      expect(quests.find((q: { id: string }) => q.id === 'trip_3').progress).toBe(1);

      expect((await h.api(p.headers, 'POST', `/cars/${car.id}/sell`)).error).toBe('car_busy');
      expect((await h.api(p.headers, 'DELETE', `/cars/${car.id}/plate`)).error).toBe('car_busy');
      expect((await h.api(p.headers, 'POST', `/cars/${car.id}/trips`, { hours: 1 })).error).toBe('car_busy');
      expect((await h.api(p.headers, 'POST', '/trips/collect')).body.trips).toBe(0);

      h.clock.advance(4 * HOUR + 1000);
      const garage = (await h.api<CarGarageDto>(p.headers, 'GET', '/cars')).body;
      const back = garage.cars.find((c) => c.id === car.id)!;
      expect(back.busy).toBeNull();
      expect(back.trip!.finished).toBe(true);
      const income = back.trip!.income!;
      expect(income).toBeGreaterThanOrEqual(0);

      const before = await chipsOf(p);
      const collected = (await h.api(p.headers, 'POST', '/trips/collect')).body;
      expect(collected).toMatchObject({ trips: 1, income });
      expect(await chipsOf(p)).toBe(before + income);
      expect((await h.api(p.headers, 'POST', '/trips/collect')).body.trips).toBe(0);
    });
  });

  describe('параллельные запросы', () => {
    it('доход покатушек начисляется один раз при одновременном сборе', async () => {
      const p = await player(2350);
      const car = await buy(p, 'zarya_2101');
      const plate = await givePlate(p, 'Н246ТУ 50');
      await mount(p, car.id, plate.id);
      await h.api(p.headers, 'POST', `/cars/${car.id}/trips`, { hours: 1 });
      h.clock.advance(HOUR + 1000);
      const before = await chipsOf(p);
      const results = await Promise.all(Array.from({ length: 4 }, () => h.api(p.headers, 'POST', '/trips/collect')));
      const total = results.reduce((s, r) => s + (r.body.income ?? 0), 0);
      const trip = await h.prisma.carTrip.findFirstOrThrow({ where: { carId: car.id } });
      expect(total).toBe(trip.income);
      expect(await chipsOf(p)).toBe(before + trip.income);
      expect(await h.prisma.ledgerEntry.count({ where: { reason: 'trip_income', refId: trip.id } })).toBe(trip.income > 0 ? 1 : 0);
    });

    it('одновременные ставки на аукционе: лидер один, деньги не теряются', async () => {
      await runScheduledTasks(h.ctx);
      const bidders = await Promise.all([2360, 2361, 2362, 2363].map((id) => player(id)));
      const lot = (await h.api<{ auction: AuctionDto }>(bidders[0]!.headers, 'GET', '/auction')).body.auction;
      const results = await Promise.all(
        bidders.map((b) => h.api(b.headers, 'POST', `/auction/${lot.id}/bids`, { amount: lot.minNextBid })),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const balances = await Promise.all(bidders.map(chipsOf));
      expect(balances.filter((c) => c < 1_000_000)).toEqual([1_000_000 - lot.minNextBid]);
    });
  });

  describe('рынок машин', () => {
    it('машина продаётся вместе с номером: деньги, комиссия, владельцы, история', async () => {
      const seller = await player(2400);
      const buyer = await player(2401);
      const car = await buy(seller, 'falke_fuenf');
      const plate = await givePlate(seller, 'М808ОР 77');
      await mount(seller, car.id, plate.id);

      const price = 50_000;
      const listing = await h.api(seller.headers, 'POST', '/car-market/listings', { carId: car.id, price });
      expect(listing.status, JSON.stringify(listing.body)).toBe(200);
      expect(listing.body.withPlate).toBe(true);
      expect((await h.api(seller.headers, 'POST', '/car-market/listings', { carId: car.id, price })).error).toBe('car_busy');
      expect((await h.api(seller.headers, 'DELETE', `/cars/${car.id}/plate`)).error).toBe('car_busy');

      const found = (await h.api(buyer.headers, 'GET', '/car-market?withPlate=true')).body;
      expect(found.items.map((i: { id: string }) => i.id)).toContain(listing.body.id);

      const sellerBefore = await chipsOf(seller);
      const bought = await h.api(buyer.headers, 'POST', `/car-market/listings/${listing.body.id}/buy`);
      expect(bought.status, JSON.stringify(bought.body)).toBe(200);
      const fee = Math.floor((price * economy.marketFeePercent) / 100);
      expect(await chipsOf(seller)).toBe(sellerBefore + price - fee);
      expect(await chipsOf(buyer)).toBe(1_000_000 - price);

      const [carRow, plateRow] = await Promise.all([
        h.prisma.userCar.findUniqueOrThrow({ where: { id: car.id }, include: { ownerships: true } }),
        h.prisma.plate.findUniqueOrThrow({ where: { id: plate.id }, include: { ownerships: true } }),
      ]);
      expect(carRow.ownerId).toBe(buyer.user.id);
      expect(carRow.plateId).toBe(plate.id);
      expect(plateRow.ownerId).toBe(buyer.user.id);
      expect(carRow.ownerships).toHaveLength(2);
      expect(plateRow.ownerships.map((o) => o.acquiredVia).sort()).toEqual(['market', 'roll']);
      expect(h.sent.some((j) => j.type === 'car_sold' && j.telegramId === '2400')).toBe(true);
      const card = (await h.api<CarCardDto>(buyer.headers, 'GET', `/cars/${car.id}`)).body;
      expect(card.recordPrice).toBe(price);
    });

    it('продажа системе: номер остаётся у игрока', async () => {
      const p = await player(2410);
      const car = await buy(p, 'zarya_2101');
      const plate = await givePlate(p, 'Т321УХ 99');
      await mount(p, car.id, plate.id);
      const before = await chipsOf(p);
      const sold = await h.api(p.headers, 'POST', `/cars/${car.id}/sell`);
      expect(sold.body.received).toBe(Math.floor(1_200 * carsConfig.sellBackPercent / 100));
      expect(await chipsOf(p)).toBe(before + sold.body.received);
      const plateRow = await h.prisma.plate.findUniqueOrThrow({ where: { id: plate.id }, include: { car: true } });
      expect(plateRow.ownerId).toBe(p.user.id);
      expect(plateRow.car).toBeNull();
    });
  });

  describe('гонки', () => {
    it('ставки, соперник из очереди, «призрак» и лимит в сутки', async () => {
      const a = await player(2500);
      const b = await player(2501);
      const carA = await buy(a, 'falke_fuenf');
      const carB = await buy(b, 'falke_fuenf');
      const startA = await chipsOf(a);
      const startB = await chipsOf(b);

      const waiting = (await h.api<RaceQueueDto>(a.headers, 'POST', '/races/queue', { carId: carA.id, bet: 100 })).body;
      expect(waiting.status).toBe('waiting');
      expect(await chipsOf(a)).toBe(startA - 100);
      expect((await h.api(a.headers, 'POST', `/cars/${carA.id}/sell`)).error).toBe('car_busy');

      const raced = (await h.api<RaceQueueDto>(b.headers, 'POST', '/races/queue', { carId: carB.id, bet: 100 })).body;
      expect(raced.status).toBe('idle');
      const race = raced.lastRace!;
      expect(race.opponent.user!.id).toBe(a.user.id);
      const fee = Math.floor((200 * DEFAULT_GAME_CONFIG.races.betFeePercent) / 100);
      const [endA, endB] = [await chipsOf(a), await chipsOf(b)];
      expect(endA + endB).toBe(startA + startB - fee);
      const winner = race.won ? b : a;
      expect(await chipsOf(winner)).toBe((winner === a ? startA : startB) + 100 - fee);
      expect(race.me.timeMs !== race.opponent.timeMs).toBe(true);
      expect(h.sent.some((j) => j.type === 'race_finished' && j.telegramId === '2500')).toBe(true);

      const aView = (await h.api<RaceQueueDto>(a.headers, 'GET', '/races/queue')).body;
      expect(aView.lastRace!.id).toBe(race.id);
      expect(aView.lastRace!.won).toBe(!race.won);

      // Соперника нет — через ghostAfterSeconds едем против «призрака», ставка возвращается.
      const beforeGhost = await chipsOf(a);
      await h.clearCooldowns();
      await h.api(a.headers, 'POST', '/races/queue', { carId: carA.id, bet: 50 });
      expect(await chipsOf(a)).toBe(beforeGhost - 50);
      expect((await h.api<RaceQueueDto>(a.headers, 'POST', '/races/queue/poll')).body.status).toBe('waiting');
      h.clock.advance((DEFAULT_GAME_CONFIG.races.matchmaking.ghostAfterSeconds + 1) * 1000);
      const ghost = (await h.api<RaceQueueDto>(a.headers, 'POST', '/races/queue/poll')).body;
      expect(ghost.status).toBe('idle');
      expect(ghost.lastRace!.opponent.user).toBeNull();
      expect(ghost.lastRace!.bet).toBe(0);
      expect(await chipsOf(a)).toBe(beforeGhost);
      expect(ghost.racesLeft).toBe(DEFAULT_GAME_CONFIG.races.dailyLimit - 2);

      await patchConfig({ races: { dailyLimit: 2 } });
      await h.clearCooldowns();
      expect((await h.api(a.headers, 'POST', '/races/queue', { carId: carA.id, bet: 0 })).error).toBe('race_limit');
    });

    it('выход из очереди возвращает ставку', async () => {
      const p = await player(2510);
      const car = await buy(p, 'zarya_2101');
      const start = await chipsOf(p);
      await h.api(p.headers, 'POST', '/races/queue', { carId: car.id, bet: 200 });
      expect((await h.api(p.headers, 'POST', '/races/queue', { carId: car.id, bet: 200 })).status).toBe(429);
      await h.clearCooldowns();
      expect((await h.api(p.headers, 'POST', '/races/queue', { carId: car.id, bet: 200 })).error).toBe('already_in_queue');
      const left = (await h.api<RaceQueueDto>(p.headers, 'DELETE', '/races/queue')).body;
      expect(left.status).toBe('idle');
      expect(await chipsOf(p)).toBe(start);
    });
  });

  describe('аукцион', () => {
    it('лот дня, ставки с возвратом перебитому, антиснайпинг и выдача номера', async () => {
      await runScheduledTasks(h.ctx);
      const a = await player(2600);
      const b = await player(2601);
      let lot = (await h.api<{ auction: AuctionDto }>(a.headers, 'GET', '/auction')).body.auction;
      expect(lot.status).toBe('active');
      expect(['legendary', 'mythic']).toContain(lot.plate.tier);
      const plateRow = await h.prisma.plate.findUniqueOrThrow({ where: { id: lot.plate.id } });
      expect(plateRow).toMatchObject({ reserved: true, ownerId: null });

      expect((await h.api(a.headers, 'POST', `/auction/${lot.id}/bids`, { amount: lot.startPrice - 1 })).error).toBe('bid_too_low');
      lot = (await h.api<AuctionDto>(a.headers, 'POST', `/auction/${lot.id}/bids`, { amount: lot.minNextBid })).body;
      const aBid = lot.currentBid!;
      expect(await chipsOf(a)).toBe(1_000_000 - aBid);
      expect((await h.api(a.headers, 'POST', `/auction/${lot.id}/bids`, { amount: lot.minNextBid })).error).toBe('already_leading');

      lot = (await h.api<AuctionDto>(b.headers, 'POST', `/auction/${lot.id}/bids`, { amount: lot.minNextBid })).body;
      expect(lot.leader!.id).toBe(b.user.id);
      expect(await chipsOf(a)).toBe(1_000_000);
      expect(h.sent.some((j) => j.type === 'auction_outbid' && j.telegramId === '2600')).toBe(true);

      // Ставка за 30 секунд до конца продлевает аукцион.
      const endsAt = Date.parse(lot.endsAt);
      h.clock.advance(endsAt - h.clock.now().getTime() - 30_000);
      lot = (await h.api<AuctionDto>(a.headers, 'POST', `/auction/${lot.id}/bids`, { amount: lot.minNextBid })).body;
      expect(Date.parse(lot.endsAt)).toBeGreaterThan(endsAt);

      h.clock.advance(2 * 60_000);
      await runScheduledTasks(h.ctx);
      const settled = await h.prisma.auction.findUniqueOrThrow({ where: { id: lot.id }, include: { plate: { include: { ownerships: true } } } });
      expect(settled.status).toBe('settled');
      expect(settled.plate).toMatchObject({ ownerId: a.user.id, reserved: false });
      expect(settled.plate.ownerships[0]!.acquiredVia).toBe('auction');
      expect(await chipsOf(a)).toBe(1_000_000 - lot.currentBid!);
      expect(await chipsOf(b)).toBe(1_000_000);
      expect(h.sent.some((j) => j.type === 'auction_won' && j.telegramId === '2600')).toBe(true);
    });
  });

  describe('автовыставка', () => {
    it('голос только у «взрослых» аккаунтов, за пару — один голос, итоги с призами', async () => {
      const entrants = await Promise.all([2700, 2701, 2702].map((id) => player(id)));
      for (const p of entrants) {
        const car = await buy(p, 'zarya_2101');
        const res = await h.api<ExhibitionDto>(p.headers, 'POST', '/exhibition/entries', { carId: car.id });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }
      const again = await h.api(entrants[0]!.headers, 'POST', '/exhibition/entries', {
        carId: (await h.prisma.userCar.findFirstOrThrow({ where: { ownerId: entrants[0]!.user.id } })).id,
      });
      expect(again.error).toBe('limit_reached');

      const voter = await player(2710);
      expect((await h.api(voter.headers, 'GET', '/exhibition/pair')).error).toBe('vote_not_allowed');
      await h.prisma.user.update({
        where: { id: voter.user.id },
        data: { createdAt: new Date(Date.now() - 10 * 24 * HOUR), totalRolls: 100 },
      });

      const pair = (await h.api<VotePairDto>(voter.headers, 'GET', '/exhibition/pair')).body.pair!;
      expect(pair[0].id).not.toBe(pair[1].id);
      const before = await chipsOf(voter);
      const voted = await h.api(voter.headers, 'POST', '/exhibition/votes', { winnerEntryId: pair[0].id });
      expect(voted.body.rewarded).toBe(true);
      expect(await chipsOf(voter)).toBe(before + DEFAULT_GAME_CONFIG.exhibition.voteRewardChips);
      expect((await h.api(voter.headers, 'POST', '/exhibition/votes', { winnerEntryId: pair[0].id })).error).toBe('vote_not_allowed');

      const entries = await h.prisma.exhibitionEntry.findMany();
      expect(entries.find((e) => e.id === pair[0].id)).toMatchObject({ wins: 1, shows: 1 });
      expect(entries.find((e) => e.id === pair[1].id)).toMatchObject({ wins: 0, shows: 1 });

      await patchConfig({ exhibition: { minShows: 1 } });
      h.clock.advance(8 * 24 * HOUR);
      await runScheduledTasks(h.ctx);
      const settled = await h.prisma.exhibitionEntry.findUniqueOrThrow({ where: { id: pair[0].id } });
      expect(settled.place).toBe(1);
      const prize = DEFAULT_GAME_CONFIG.exhibition.prizes[0]!;
      const winner = await h.prisma.user.findUniqueOrThrow({ where: { id: settled.userId } });
      expect(winner.chips).toBe(1_000_000 - 1_200 + prize.chips);
      expect(h.sent.some((j) => j.type === 'reward' && j.reason === 'exhibition')).toBe(true);
    });
  });

  describe('клубы', () => {
    it('создание, уникальное имя, лимит участников, передача владельца', async () => {
      const [a, b, c] = (await Promise.all([2800, 2801, 2802].map((id) => player(id)))) as [Player, Player, Player];
      const club = await h.api<ClubDto>(a.headers, 'POST', '/clubs', { name: 'Блатные 777', chatLink: 'https://t.me/blatnye777' });
      expect(club.status, JSON.stringify(club.body)).toBe(200);
      expect(await chipsOf(a)).toBe(1_000_000 - DEFAULT_GAME_CONFIG.clubs.createCostChips);
      expect((await h.api(c.headers, 'POST', '/clubs', { name: 'блатные 777' })).error).toBe('name_taken');
      expect((await h.api(c.headers, 'POST', '/clubs', { name: 'Клуб', chatLink: 'https://evil.example' })).status).toBe(400);

      await patchConfig({ clubs: { maxMembers: 2 } });
      expect((await h.api(b.headers, 'POST', `/clubs/${club.body.id}/join`)).status).toBe(200);
      expect((await h.api(c.headers, 'POST', `/clubs/${club.body.id}/join`)).error).toBe('club_full');
      expect((await h.api(b.headers, 'POST', `/clubs/${club.body.id}/join`)).error).toBe('already_in_club');

      await h.api(a.headers, 'POST', '/clubs/leave');
      const after = (await h.api<{ club: ClubDto }>(b.headers, 'GET', '/clubs/mine')).body.club!;
      expect(after.members).toHaveLength(1);
      expect(after.members[0]).toMatchObject({ role: 'owner' });
      expect((await h.api(b.headers, 'GET', '/clubs')).body.map((x: { id: string }) => x.id)).toContain(club.body.id);
    });
  });

  describe('номер мечты', () => {
    it('бот пишет, когда номер под маску выставлен на рынок', async () => {
      const dreamer = await player(2900);
      const seller = await player(2901);
      expect((await h.api(dreamer.headers, 'POST', '/dream-masks', { mask: '******' })).status).toBe(400);
      const mask = await h.api(dreamer.headers, 'POST', '/dream-masks', { mask: '*777** 50' });
      expect(mask.status, JSON.stringify(mask.body)).toBe(200);

      const plate = await givePlate(seller, 'А777ВС 50');
      await h.api(seller.headers, 'POST', '/market/listings', { plateId: plate.id, price: 5_000 });
      const job = h.sent.find((j) => j.type === 'dream_plate');
      expect(job).toMatchObject({ telegramId: '2900', mask: '*777** 50', source: 'market', price: 5_000 });

      const other = await givePlate(seller, 'А778ВС 50');
      h.sent.length = 0;
      await h.api(seller.headers, 'POST', '/market/listings', { plateId: other.id, price: 5_000 });
      expect(h.sent.some((j) => j.type === 'dream_plate')).toBe(false);
    });
  });

  describe('оплата Stars', () => {
    it('коллекционная машина за Stars; если тираж кончился — Stars возвращаются', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: true })));
      const p = await h.login(3000);
      const model = await h.prisma.carModel.findUniqueOrThrow({ where: { id: 'sokol_prototype_1' } });
      const pay = (id: string) => ({
        payload: id,
        telegramUserId: '3000',
        currency: 'XTR',
        totalAmount: model.priceStars!,
        telegramChargeId: `charge-${id}`,
      });

      const p1 = await h.prisma.payment.create({
        data: { userId: p.user.id, kind: 'car', packId: model.id, stars: model.priceStars!, meta: { color: null } },
      });
      const ok = await h.app.inject({ method: 'POST', url: '/internal/payments/success', headers: INTERNAL, payload: pay(p1.id) });
      expect(ok.json()).toMatchObject({ duplicate: false, kind: 'car', refunded: false });
      expect(await h.prisma.userCar.count({ where: { ownerId: p.user.id, modelId: model.id } })).toBe(1);

      await h.prisma.carModel.update({ where: { id: model.id }, data: { sold: model.editionSize! } });
      const p2 = await h.prisma.payment.create({
        data: { userId: p.user.id, kind: 'car', packId: model.id, stars: model.priceStars!, meta: {} },
      });
      const pre = await h.app.inject({ method: 'POST', url: '/internal/payments/pre-checkout', headers: INTERNAL, payload: pay(p2.id) });
      expect(pre.json().ok).toBe(false);
      const refunded = await h.app.inject({ method: 'POST', url: '/internal/payments/success', headers: INTERNAL, payload: pay(p2.id) });
      expect(refunded.json()).toMatchObject({ refunded: true });
      expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe('refunded');
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/refundStarPayment'))).toBe(true);
      expect(await h.prisma.userCar.count({ where: { ownerId: p.user.id } })).toBe(1);

      const dup = await h.app.inject({ method: 'POST', url: '/internal/payments/success', headers: INTERNAL, payload: pay(p2.id) });
      expect(dup.json()).toMatchObject({ duplicate: true, refunded: true });
    });
  });
});
