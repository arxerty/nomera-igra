import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { canJoinClub, isValidClubChatLink, isValidClubName, type ClubDto, type ClubListItemDto } from '@nomer/shared';
import { afterCommit, type AppContext } from '../context';
import { lockUsers, withTx, type Tx } from '../lib/db';
import { PUBLIC_USER_SELECT, userPublic } from '../lib/dto';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
import { changeBalance } from '../lib/ledger';

export const createClubSchema = z.object({
  name: z.string().max(64),
  chatLink: z.string().max(200).nullish(),
});

function validateChatLink(link: string | null | undefined): string | null {
  if (!link) return null;
  if (!isValidClubChatLink(link)) throw badRequest('Ссылка на чат должна вести на t.me');
  return link;
}

async function lockClub(tx: Tx, clubId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Club" WHERE id = ${clubId} FOR UPDATE`;
  if (!rows[0]) throw notFound('Клуб не найден');
}

export async function getClub(ctx: AppContext, viewerId: string, clubId: string): Promise<ClubDto> {
  const { config } = await ctx.config.get();
  const club = await ctx.prisma.club.findUnique({
    where: { id: clubId },
    include: { members: { include: { user: { select: PUBLIC_USER_SELECT } }, orderBy: { joinedAt: 'asc' } } },
  });
  if (!club) throw notFound('Клуб не найден');
  const [values, rank] = await Promise.all([
    ctx.leaderboard.scoresOf(club.members.map((m) => m.userId)),
    ctx.leaderboard.clubRank(clubId),
  ]);
  const members = club.members
    .map((m) => ({ user: userPublic(m.user), role: m.role, value: values.get(m.userId) ?? 0, joinedAt: m.joinedAt.toISOString() }))
    .sort((x, y) => y.value - x.value);
  return {
    id: club.id,
    name: club.name,
    chatLink: club.chatLink,
    rating: members.reduce((s, m) => s + m.value, 0),
    rank: rank.rank,
    members,
    maxMembers: config.clubs.maxMembers,
    isMember: club.members.some((m) => m.userId === viewerId),
  };
}

export async function myClub(ctx: AppContext, userId: string): Promise<ClubDto | null> {
  const member = await ctx.prisma.clubMember.findUnique({ where: { userId } });
  return member ? getClub(ctx, userId, member.clubId) : null;
}

export async function listClubs(ctx: AppContext, limit: number): Promise<ClubListItemDto[]> {
  const top = await ctx.leaderboard.topClubs(limit);
  const clubs = await ctx.prisma.club.findMany({
    where: { id: { in: top.map((t) => t.id) } },
    include: { _count: { select: { members: true } } },
  });
  const byId = new Map(clubs.map((c) => [c.id, c]));
  return top
    .filter((t) => byId.has(t.id))
    .map((t, i) => {
      const c = byId.get(t.id)!;
      return { id: c.id, name: c.name, memberCount: c._count.members, rating: t.score, rank: i + 1 };
    });
}

export async function createClub(ctx: AppContext, userId: string, input: z.infer<typeof createClubSchema>): Promise<ClubDto> {
  const { config } = await ctx.config.get();
  const name = input.name.trim();
  if (!isValidClubName(name, config.clubs)) {
    throw badRequest(`Название клуба: ${config.clubs.nameMinLength}–${config.clubs.nameMaxLength} символов, буквы и цифры`);
  }
  const chatLink = validateChatLink(input.chatLink);
  const club = await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    if (await tx.clubMember.findUnique({ where: { userId } })) throw new AppError(409, 'already_in_club', 'Вы уже состоите в клубе');
    const created = await tx.club
      .create({ data: { name, nameKey: name.toLowerCase(), chatLink, members: { create: { userId, role: 'owner' } } } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError(409, 'name_taken', 'Клуб с таким названием уже есть');
        }
        throw err;
      });
    await changeBalance(tx, { userId, currency: 'chips', delta: -config.clubs.createCostChips, reason: 'club_create', refId: created.id });
    return created;
  });
  await afterCommit(ctx, ctx.leaderboard.refreshClubs([club.id]));
  return getClub(ctx, userId, club.id);
}

export async function joinClub(ctx: AppContext, userId: string, clubId: string): Promise<ClubDto> {
  const { config } = await ctx.config.get();
  await withTx(ctx.prisma, async (tx) => {
    await lockUsers(tx, [userId]);
    await lockClub(tx, clubId);
    if (await tx.clubMember.findUnique({ where: { userId } })) throw new AppError(409, 'already_in_club', 'Вы уже состоите в клубе');
    const count = await tx.clubMember.count({ where: { clubId } });
    if (!canJoinClub(count, config.clubs)) throw new AppError(409, 'club_full', 'В клубе нет мест');
    await tx.clubMember.create({ data: { userId, clubId } });
  });
  await afterCommit(ctx, ctx.leaderboard.refreshClubs([clubId]));
  return getClub(ctx, userId, clubId);
}

/** Выход из клуба. Владелец передаёт клуб самому давнему участнику; последний участник распускает клуб. */
export async function leaveClub(ctx: AppContext, userId: string): Promise<void> {
  const clubId = await withTx(ctx.prisma, async (tx) => {
    const member = await tx.clubMember.findUnique({ where: { userId } });
    if (!member) throw notFound('Вы не состоите в клубе');
    await lockClub(tx, member.clubId);
    await tx.clubMember.delete({ where: { userId } });
    const next = await tx.clubMember.findFirst({ where: { clubId: member.clubId }, orderBy: { joinedAt: 'asc' } });
    if (!next) {
      await tx.club.delete({ where: { id: member.clubId } });
    } else if (member.role === 'owner') {
      await tx.clubMember.update({ where: { userId: next.userId }, data: { role: 'owner' } });
    }
    return member.clubId;
  });
  await afterCommit(ctx, ctx.leaderboard.refreshClubs([clubId]));
}

async function ownedClubId(tx: Tx, ownerId: string): Promise<string> {
  const member = await tx.clubMember.findUnique({ where: { userId: ownerId } });
  if (!member || member.role !== 'owner') throw forbidden('Это может только владелец клуба');
  await lockClub(tx, member.clubId);
  return member.clubId;
}

export async function updateClubChat(ctx: AppContext, ownerId: string, chatLink: string | null): Promise<ClubDto> {
  const link = validateChatLink(chatLink);
  const clubId = await withTx(ctx.prisma, async (tx) => {
    const id = await ownedClubId(tx, ownerId);
    await tx.club.update({ where: { id }, data: { chatLink: link } });
    return id;
  });
  return getClub(ctx, ownerId, clubId);
}

export async function kickMember(ctx: AppContext, ownerId: string, userId: string): Promise<ClubDto> {
  if (userId === ownerId) throw badRequest('Чтобы уйти самому, выйдите из клуба');
  const clubId = await withTx(ctx.prisma, async (tx) => {
    const id = await ownedClubId(tx, ownerId);
    const { count } = await tx.clubMember.deleteMany({ where: { userId, clubId: id } });
    if (count === 0) throw notFound('Игрок не состоит в вашем клубе');
    return id;
  });
  await afterCommit(ctx, ctx.leaderboard.refreshClubs([clubId]));
  return getClub(ctx, ownerId, clubId);
}
