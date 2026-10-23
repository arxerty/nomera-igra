import {
  formatPlate,
  isAcceptableDreamMask,
  maskToSqlLike,
  parseMask,
  plateBody,
  type DreamMaskDto,
  type Plate,
} from '@nomer/shared';
import type { AppContext } from '../context';
import { AppError, badRequest, notFound } from '../lib/errors';

function maskDto(m: { id: string; mask: string; createdAt: Date }): DreamMaskDto {
  return { id: m.id, mask: m.mask, createdAt: m.createdAt.toISOString() };
}

export async function listDreamMasks(ctx: AppContext, userId: string): Promise<DreamMaskDto[]> {
  const rows = await ctx.prisma.dreamMask.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return rows.map(maskDto);
}

export async function addDreamMask(ctx: AppContext, userId: string, input: string): Promise<DreamMaskDto> {
  const { config } = await ctx.config.get();
  const mask = parseMask(input);
  if (!mask) throw badRequest('Некорректная маска. Пример: *777** 77');
  if (!isAcceptableDreamMask(mask, config.dreamSearch)) {
    throw badRequest(`Задайте хотя бы ${config.dreamSearch.minFixedChars} символа маски`);
  }
  const count = await ctx.prisma.dreamMask.count({ where: { userId } });
  if (count >= config.dreamSearch.maxMasks) {
    throw new AppError(409, 'limit_reached', `Не больше ${config.dreamSearch.maxMasks} масок`);
  }
  const canonical = [mask.body.map((c) => c ?? '*').join(''), mask.region?.map((c) => c ?? '*').join('')]
    .filter(Boolean)
    .join(' ');
  const like = maskToSqlLike(mask);
  const row = await ctx.prisma.dreamMask.upsert({
    where: { userId_mask: { userId, mask: canonical } },
    create: { userId, mask: canonical, bodyLike: like.body, regionLike: like.region },
    update: {},
  });
  return maskDto(row);
}

export async function deleteDreamMask(ctx: AppContext, userId: string, id: string): Promise<void> {
  const { count } = await ctx.prisma.dreamMask.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound('Маска не найдена');
}

/**
 * Номер появился на рынке или аукционе: уведомить всех, у кого он подходит под маску мечты.
 * Поиск обратный — LIKE по сохранённым шаблонам масок. Вызывается после коммита.
 */
export async function notifyDreamMatches(
  ctx: AppContext,
  plate: Plate,
  source: 'market' | 'auction',
  price: number,
  refId: string,
  excludeUserId: string | null,
): Promise<void> {
  const body = plateBody(plate);
  const rows = await ctx.prisma.$queryRaw<{ userId: string; mask: string }[]>`
    SELECT DISTINCT ON (m."userId") m."userId", m.mask
    FROM "DreamMask" m
    WHERE ${body} LIKE m."bodyLike"
      AND (m."regionLike" IS NULL OR ${plate.region} LIKE m."regionLike")
      AND m."userId" <> ${excludeUserId ?? ''}
    ORDER BY m."userId", m."createdAt"`;
  if (rows.length === 0) return;
  const users = await ctx.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  await Promise.all(
    rows.map((r) =>
      ctx.notifier.send(
        byId.get(r.userId)!,
        { type: 'dream_plate', plate: formatPlate(plate), mask: r.mask, source, price },
        { jobId: `dream-${r.userId}-${source}-${refId}` },
      ),
    ),
  );
}
