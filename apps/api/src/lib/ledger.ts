import { Prisma, type Currency, type LedgerReason } from '@prisma/client';
import { AppError } from './errors';
import type { Tx } from './db';

const COLUMN: Record<Currency, Prisma.Sql> = {
  chips: Prisma.raw('"chips"'),
  rolls: Prisma.raw('"rolls"'),
};

/**
 * Атомарно меняет баланс и пишет запись в журнал. Списание с недостаточным
 * балансом не проходит: условие `balance + delta >= 0` проверяется в том же UPDATE,
 * поэтому параллельные запросы не уведут баланс в минус.
 */
export async function changeBalance(
  tx: Tx,
  args: { userId: string; currency: Currency; delta: number; reason: LedgerReason; refId?: string; note?: string },
): Promise<number> {
  const { userId, currency, delta, reason, refId, note } = args;
  if (!Number.isSafeInteger(delta)) throw new Error(`Некорректная сумма: ${delta}`);
  const col = COLUMN[currency];

  const rows = await tx.$queryRaw<{ balance: number }[]>`
    UPDATE "User" SET ${col} = ${col} + ${delta}, "updatedAt" = now()
    WHERE id = ${userId} AND ${col} + ${delta} >= 0
    RETURNING ${col} AS balance`;

  const row = rows[0];
  if (!row) {
    throw currency === 'chips'
      ? new AppError(409, 'insufficient_funds', 'Недостаточно Фишек')
      : new AppError(409, 'no_rolls', 'Нет попыток');
  }
  if (delta !== 0) {
    await tx.ledgerEntry.create({
      data: { userId, currency, delta, balanceAfter: row.balance, reason, refId, note },
    });
  }
  return row.balance;
}
