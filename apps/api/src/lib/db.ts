import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError, notFound } from './errors';

export type Tx = Prisma.TransactionClient;

const RETRYABLE_PG_CODES = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  const pgCode = (err.meta as { code?: string } | undefined)?.code;
  return err.code === 'P2010' && pgCode !== undefined && RETRYABLE_PG_CODES.has(pgCode);
}

/**
 * Транзакция с повтором при дедлоке или конфликте сериализации.
 * Все денежные и имущественные операции идут только через неё.
 */
export async function withTx<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await prisma.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err;
    }
  }
}

/** Блокирует строки пользователей в порядке id, чтобы встречные сделки не взаимоблокировались. */
export async function lockUsers(tx: Tx, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}

/** Блокирует строки номеров в порядке id. Возвращает id найденных номеров. */
export async function lockPlates(tx: Tx, plateIds: string[]): Promise<Set<string>> {
  if (plateIds.length === 0) return new Set();
  const ids = [...new Set(plateIds)].sort();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Plate" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  return new Set(rows.map((r) => r.id));
}

export const WITH_ACTIVE_LISTING = {
  listings: { where: { status: 'active' }, select: { id: true, price: true }, take: 1 },
  car: { select: { id: true } },
} satisfies Prisma.PlateInclude;

export type PlateWithListing = Prisma.PlateGetPayload<{ include: typeof WITH_ACTIVE_LISTING }>;

/** Блокирует номер и проверяет, что он принадлежит пользователю. */
export async function lockOwnedPlate(tx: Tx, plateId: string, userId: string): Promise<PlateWithListing> {
  const found = await lockPlates(tx, [plateId]);
  if (!found.has(plateId)) throw notFound('Номер не найден');
  const plate = await tx.plate.findUniqueOrThrow({ where: { id: plateId }, include: WITH_ACTIVE_LISTING });
  if (plate.ownerId !== userId) throw new AppError(403, 'not_owner', 'Это не ваш номер');
  return plate;
}

export function assertNotListed(plate: PlateWithListing): void {
  if (plate.listings.length > 0) {
    throw new AppError(409, 'plate_listed', 'Номер выставлен на рынок — сначала снимите его с продажи');
  }
}

export function assertNotMounted(plate: PlateWithListing): void {
  if (plate.car) throw new AppError(409, 'plate_mounted', 'Номер висит на машине — сначала снимите его');
}

/** Номер можно продать, выставить или обменять: он не на рынке и не на машине. */
export function assertPlateFree(plate: PlateWithListing): void {
  assertNotListed(plate);
  assertNotMounted(plate);
}

/** Передаёт номер другому владельцу и ведёт паспорт. */
export async function transferPlate(
  tx: Tx,
  args: { plateId: string; fromUserId: string; toUserId: string; via: 'market' | 'trade'; price: number | null; at: Date },
): Promise<void> {
  const { plateId, fromUserId, toUserId, via, price, at } = args;
  await tx.plateOwnership.updateMany({
    where: { plateId, userId: fromUserId, releasedAt: null },
    data: { releasedAt: at, releasedVia: via, releasedPrice: price },
  });
  await tx.plate.update({ where: { id: plateId }, data: { ownerId: toUserId, acquiredAt: at } });
  await tx.plateOwnership.create({
    data: { plateId, userId: toUserId, acquiredAt: at, acquiredVia: via, acquiredPrice: price },
  });
}
