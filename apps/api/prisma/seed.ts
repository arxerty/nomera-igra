/**
 * Тестовые данные для локальной разработки.
 *
 *   npm run db:seed              — добавить данные (если сид уже был — ничего не делает)
 *   npm run db:seed -- --reset   — очистить все игровые таблицы и залить заново
 *
 * SEED_TELEGRAM_ID=<ваш id> — дополнительно создать/обновить вашего игрока с хорошей
 * коллекцией и входящим предложением обмена (удобно проверять Mini App в Telegram).
 *
 * Генерация детерминирована (сидированный ГПСЧ), номера строятся тем же генератором
 * и классификатором из @nomer/shared, что и в игре.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient, type User } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  DEFAULT_CAR_MODELS,
  DEFAULT_GAME_CONFIG,
  classifyPlate,
  createSeededRng,
  gameSeasonStart,
  gameWeekStart,
  generatePlate,
  marketSettlement,
  plateBody,
  plateKey,
  plateValue,
  stockTuning,
  type CarClass,
  type Tier,
} from '@nomer/shared';
import { LeaderboardService, leaderboardPeriod } from '../src/services/leaderboard';
import { syncCarCatalog } from '../src/services/showroom';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const rng = createSeededRng(2026);
const config = DEFAULT_GAME_CONFIG;
const DAY = 86_400_000;
const now = new Date();

/** Telegram ID тестовых игроков: заведомо отдельный диапазон, уведомления им выключены. */
const SEED_ID_BASE = 7_000_000_000n;

const PLAYERS: { name: string; username: string; tiers: Partial<Record<Tier, number>>; chips: number }[] = [
  { name: 'Гоша Блатной', username: 'gosha_blat', tiers: { mythic: 1, legendary: 2, epic: 3, rare: 4, uncommon: 4, common: 6 }, chips: 42_000 },
  { name: 'Марина', username: 'marina_77', tiers: { legendary: 2, epic: 2, rare: 3, uncommon: 4, common: 5 }, chips: 18_500 },
  { name: 'Lex', username: 'lex_plates', tiers: { legendary: 1, epic: 2, rare: 3, uncommon: 3, common: 6 }, chips: 9_200 },
  { name: 'Дима 777', username: 'dima777', tiers: { epic: 2, rare: 3, uncommon: 4, common: 7 }, chips: 6_400 },
  { name: 'Оля', username: 'olya_auto', tiers: { epic: 1, rare: 2, uncommon: 3, common: 6 }, chips: 3_100 },
  { name: 'Серёга', username: 'serega_ekx', tiers: { legendary: 1, rare: 2, uncommon: 2, common: 4 }, chips: 2_700 },
  { name: 'Катя', username: 'katya_k', tiers: { rare: 2, uncommon: 3, common: 5 }, chips: 1_900 },
  { name: 'Артур', username: 'artur_sto', tiers: { epic: 1, rare: 1, uncommon: 2, common: 4 }, chips: 1_400 },
  { name: 'Влад', username: 'vlad_v', tiers: { rare: 1, uncommon: 2, common: 4 }, chips: 800 },
  { name: 'Нина', username: 'nina_n', tiers: { uncommon: 2, common: 3 }, chips: 350 },
];

const MY_TIERS: Partial<Record<Tier, number>> = { mythic: 1, legendary: 2, epic: 2, rare: 3, uncommon: 3, common: 4 };

const usedKeys = new Set<string>();

function randomInt(min: number, max: number): number {
  return min + rng.int(max - min + 1);
}

/** Случайный момент за последние `days` дней. */
function pastDate(days: number): Date {
  return new Date(now.getTime() - rng.int(days * DAY));
}

async function createPlate(owner: User, tier: Tier, acquiredAt: Date) {
  for (;;) {
    const plate = generatePlate(tier, rng, { regions: config.regions, rarity: config.rarity });
    if (!plate) throw new Error(`Тир ${tier} недостижим при текущем конфиге`);
    const key = plateKey(plate);
    if (usedKeys.has(key) || (await prisma.plate.findUnique({ where: { key } }))) continue;
    usedKeys.add(key);

    const rarity = classifyPlate(plate, config.rarity);
    const value = plateValue(rarity, config.prices);
    const created = await prisma.plate.create({
      data: {
        key,
        body: plateBody(plate),
        letters: plate.letters,
        number: plate.number,
        region: plate.region,
        tier: rarity.tier,
        value,
        traits: rarity.traits,
        bonuses: rarity.bonuses,
        ownerId: owner.id,
        acquiredAt,
        firstRolledAt: acquiredAt,
      },
    });
    await prisma.plateOwnership.create({
      data: { plateId: created.id, userId: owner.id, acquiredAt, acquiredVia: 'roll' },
    });
    await prisma.rollLog.create({
      data: {
        userId: owner.id,
        plateId: created.id,
        plateKey: key,
        rolledTier: rarity.tier,
        tier: rarity.tier,
        value,
        source: rng.int(2) ? 'free' : 'balance',
        configVersion: 1,
        createdAt: acquiredAt,
      },
    });
    return created;
  }
}

async function createUser(args: {
  telegramId: bigint;
  firstName: string;
  username: string | null;
  chips: number;
  rolls: number;
  seedUser: boolean;
}): Promise<User> {
  const data = {
    firstName: args.firstName,
    username: args.username,
    chips: args.chips,
    rolls: args.rolls,
    streakDay: randomInt(0, 6),
    totalRolls: 0,
    createdAt: pastDate(30),
    // Тестовым игрокам бот ничего не пишет.
    notificationsEnabled: !args.seedUser,
    botBlocked: args.seedUser,
  };
  const user = await prisma.user.upsert({
    where: { telegramId: args.telegramId },
    create: { telegramId: args.telegramId, ...data },
    update: { chips: args.chips, rolls: args.rolls },
  });
  await prisma.ledgerEntry.create({
    data: { userId: user.id, currency: 'chips', delta: args.chips, balanceAfter: args.chips, reason: 'admin_adjust', note: 'seed' },
  });
  await prisma.ledgerEntry.create({
    data: { userId: user.id, currency: 'rolls', delta: args.rolls, balanceAfter: args.rolls, reason: 'admin_adjust', note: 'seed' },
  });
  return user;
}

async function giveCollection(user: User, tiers: Partial<Record<Tier, number>>) {
  let count = 0;
  for (const [tier, n] of Object.entries(tiers) as [Tier, number][]) {
    for (let i = 0; i < n; i++) {
      // Часть номеров — за эту неделю, чтобы недельный рейтинг не был пустым.
      await createPlate(user, tier, rng.int(3) === 0 ? new Date(now.getTime() - rng.int(2 * DAY)) : pastDate(20));
      count++;
    }
  }
  await prisma.user.update({ where: { id: user.id }, data: { totalRolls: count + randomInt(5, 60) } });
}

/** Сделка на рынке в прошлом: даёт номеру паспорт из двух владельцев. */
async function pastMarketSale(seller: User, buyer: User) {
  const plate = await prisma.plate.findFirst({ where: { ownerId: seller.id, tier: 'rare' } });
  if (!plate) return;
  const at = pastDate(5);
  const price = plate.value * 3;
  const { fee } = marketSettlement(price, config.economy.marketFeePercent);
  const listing = await prisma.listing.create({
    data: { plateId: plate.id, sellerId: seller.id, price, status: 'sold', buyerId: buyer.id, fee, createdAt: at, closedAt: at },
  });
  await prisma.plateOwnership.updateMany({
    where: { plateId: plate.id, releasedAt: null },
    data: { releasedAt: at, releasedVia: 'market', releasedPrice: price },
  });
  await prisma.plate.update({ where: { id: plate.id }, data: { ownerId: buyer.id, acquiredAt: at } });
  await prisma.plateOwnership.create({
    data: { plateId: plate.id, userId: buyer.id, acquiredAt: at, acquiredVia: 'market', acquiredPrice: price },
  });
  await prisma.dealLog.create({
    data: { type: 'market_sale', plateKeys: [plate.key], fromUserId: seller.id, toUserId: buyer.id, price, fee, refId: listing.id, createdAt: at },
  });
}

async function listOnMarket(user: User, count: number) {
  const plates = await prisma.plate.findMany({ where: { ownerId: user.id }, orderBy: { value: 'desc' }, take: count + 2 });
  for (const plate of plates.slice(1, 1 + count)) {
    const price = Math.max(config.economy.minListingPrice, plate.value * randomInt(2, 5));
    await prisma.listing.create({
      data: { plateId: plate.id, sellerId: user.id, price, activePlateId: plate.id, createdAt: pastDate(3) },
    });
  }
}

async function tradeOffer(from: User, to: User) {
  const [offered, requested] = await Promise.all([
    prisma.plate.findFirst({ where: { ownerId: from.id, tier: 'uncommon', listings: { none: { status: 'active' } } } }),
    prisma.plate.findFirst({ where: { ownerId: to.id, tier: 'uncommon', listings: { none: { status: 'active' } } } }),
  ]);
  if (!offered || !requested) return null;
  return prisma.tradeOffer.create({
    data: {
      code: randomBytes(6).toString('base64url'),
      fromUserId: from.id,
      toUserId: to.id,
      offeredChips: 50,
      message: 'Меняю с доплатой, номер красивый 😉',
      expiresAt: new Date(now.getTime() + config.economy.tradeOfferTtlHours * 3_600_000),
      items: {
        create: [
          { plateId: offered.id, side: 'offered' },
          { plateId: requested.id, side: 'requested' },
        ],
      },
    },
  });
}

/**
 * Машины игрока: по одной модели на каждый класс из списка. На машину вешается номер,
 * дающий «Статус», если такой есть в коллекции, иначе — самый ценный свободный.
 */
async function giveCars(user: User, classes: CarClass[]) {
  const status = config.cars.combos.status.tierByClass;
  for (const cls of classes) {
    const models = DEFAULT_CAR_MODELS.filter((m) => m.class === cls);
    const model = models[rng.int(models.length)]!;
    const sold = await prisma.carModel.update({ where: { id: model.id }, data: { sold: { increment: 1 } } });
    const at = pastDate(15);
    const free = await prisma.plate.findMany({
      where: { ownerId: user.id, car: { is: null }, listings: { none: { status: 'active' } } },
      orderBy: { value: 'desc' },
    });
    const plate = free.find((p) => p.tier === status[cls]) ?? free[0];
    const palette = config.cars.tuning.palette;
    const car = await prisma.userCar.create({
      data: {
        ownerId: user.id,
        modelId: model.id,
        serial: model.editionSize ? sold.sold : null,
        tuning: stockTuning(palette[rng.int(palette.length)]!) as object,
        plateId: plate?.id ?? null,
        acquiredAt: at,
      },
    });
    await prisma.carOwnership.create({
      data: { carId: car.id, userId: user.id, acquiredAt: at, acquiredVia: 'showroom', acquiredPrice: model.priceChips },
    });
  }
}

const CAR_CLASSES_BY_PLAYER: CarClass[][] = [
  ['luxury', 'business', 'economy'],
  ['premium', 'comfort'],
  ['business', 'economy'],
  ['comfort', 'economy'],
  ['economy'],
  ['comfort'],
  ['economy'],
];

const TABLES = [
  'ExhibitionVote', 'ExhibitionEntry', 'Exhibition', 'AuctionBid', 'Auction', 'Race', 'RaceQueueEntry',
  'CarTrip', 'CarListing', 'CarOwnership', 'UserCar', 'ClubMember', 'Club', 'DreamMask', 'UserAchievement',
  'SchedulerRun', 'TradeItem', 'TradeOffer', 'Listing', 'PlateOwnership', 'RollLog', 'DealLog', 'LedgerEntry',
  'Payment', 'QuestProgress', 'Plate', 'User',
];

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const keys = await redis.keys('lb:*');
    if (keys.length) await redis.del(...keys);
    console.log('Игровые таблицы очищены');
  } else if (await prisma.user.findUnique({ where: { telegramId: SEED_ID_BASE + 1n } })) {
    console.log('Сид уже применён. Для перезаливки: npm run db:seed -- --reset');
    return;
  }

  if (!(await prisma.gameConfigVersion.findFirst())) {
    await prisma.gameConfigVersion.create({ data: { data: config as object } });
  }
  await syncCarCatalog(prisma);
  if (reset) await prisma.carModel.updateMany({ data: { sold: 0 } });

  const users: User[] = [];
  for (const [i, p] of PLAYERS.entries()) {
    const user = await createUser({
      telegramId: SEED_ID_BASE + BigInt(i + 1),
      firstName: p.name,
      username: p.username,
      chips: p.chips,
      rolls: randomInt(0, 8),
      seedUser: true,
    });
    await giveCollection(user, p.tiers);
    users.push(user);
  }
  console.log(`Игроков: ${users.length}`);

  await pastMarketSale(users[3]!, users[0]!);
  await pastMarketSale(users[4]!, users[1]!);
  for (const u of users.slice(0, 7)) await listOnMarket(u, randomInt(1, 2));
  for (const [i, classes] of CAR_CLASSES_BY_PLAYER.entries()) await giveCars(users[i]!, classes);
  // Пара машин на рынке: одна с номером, одна без.
  for (const u of [users[2]!, users[3]!]) {
    const car = await prisma.userCar.findFirst({ where: { ownerId: u.id }, include: { model: true } });
    if (car) {
      await prisma.carListing.create({
        data: { carId: car.id, sellerId: u.id, price: car.model.priceChips, withPlate: car.plateId !== null, activeCarId: car.id, createdAt: pastDate(2) },
      });
    }
  }
  // Рефералы: Нина и Влад пришли по ссылке Гоши.
  await prisma.user.updateMany({ where: { id: { in: [users[8]!.id, users[9]!.id] } }, data: { referredById: users[0]!.id } });
  await tradeOffer(users[1]!, users[2]!);

  const myId = process.env.SEED_TELEGRAM_ID;
  if (myId && /^\d+$/.test(myId)) {
    const me = await createUser({
      telegramId: BigInt(myId),
      firstName: 'Вы',
      username: null,
      chips: 5_000,
      rolls: 20,
      seedUser: false,
    });
    if ((await prisma.plate.count({ where: { ownerId: me.id } })) === 0) {
      await giveCollection(me, MY_TIERS);
      await giveCars(me, ['business', 'economy']);
    }
    await tradeOffer(users[0]!, me);
    console.log(`Ваш игрок (Telegram ID ${myId}) готов: 20 попыток, 5 000 Фишек, коллекция, машины и входящий обмен`);
  }

  const offset = config.economy.dayOffsetHours;
  await new LeaderboardService(prisma, redis, async () => config).rebuild(
    leaderboardPeriod(now, offset),
    gameWeekStart(now, offset),
    gameSeasonStart(now, offset),
  );

  const [plates, listings, cars] = await Promise.all([
    prisma.plate.count(),
    prisma.listing.count({ where: { status: 'active' } }),
    prisma.userCar.count(),
  ]);
  console.log(`Номеров: ${plates}, лотов на рынке: ${listings}, машин: ${cars}. Рейтинги пересобраны.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
