import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { DEFAULT_GAME_CONFIG, gameConfigSchema, type GameConfig } from '@nomer/shared';

export interface ActiveConfig {
  version: number;
  config: GameConfig;
}

const REDIS_KEY = 'config:active';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Дополняет сохранённый конфиг полями, появившимися в новых версиях игры:
 * верхний уровень и вложенные объекты-секции сливаются с дефолтами.
 */
export function withDefaults(stored: unknown): unknown {
  if (!isPlainObject(stored)) return stored;
  const merged: Record<string, unknown> = { ...DEFAULT_GAME_CONFIG };
  for (const [key, value] of Object.entries(stored)) {
    const def = (DEFAULT_GAME_CONFIG as Record<string, unknown>)[key];
    merged[key] = isPlainObject(def) && isPlainObject(value) ? { ...def, ...value } : value;
  }
  return merged;
}

/** Активный конфиг игры: БД — источник истины, Redis — общий кеш, память — на 5 секунд. */
export class ConfigService {
  private cached: { value: ActiveConfig; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly ttlMs = 5_000,
  ) {}

  async get(): Promise<ActiveConfig> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    const value = (await this.fromRedis()) ?? (await this.fromDb());
    this.cached = { value, at: Date.now() };
    return value;
  }

  async save(config: unknown, adminTelegramId: bigint | null): Promise<ActiveConfig> {
    const parsed = gameConfigSchema.parse(config);
    const row = await this.prisma.gameConfigVersion.create({
      data: { data: parsed as unknown as Prisma.InputJsonValue, createdBy: adminTelegramId },
    });
    const value: ActiveConfig = { version: row.version, config: parsed };
    await this.redis.set(REDIS_KEY, JSON.stringify(value));
    this.cached = { value, at: Date.now() };
    return value;
  }

  async history(limit = 20) {
    return this.prisma.gameConfigVersion.findMany({
      orderBy: { version: 'desc' },
      take: limit,
      select: { version: true, createdBy: true, createdAt: true },
    });
  }

  private async fromRedis(): Promise<ActiveConfig | null> {
    const raw = await this.redis.get(REDIS_KEY);
    if (!raw) return null;
    try {
      const { version, config } = JSON.parse(raw) as { version: number; config: unknown };
      return { version, config: gameConfigSchema.parse(withDefaults(config)) };
    } catch {
      return null;
    }
  }

  private async fromDb(): Promise<ActiveConfig> {
    const row = await this.prisma.gameConfigVersion.findFirst({ orderBy: { version: 'desc' } });
    if (!row) return this.save(DEFAULT_GAME_CONFIG, null);
    const value: ActiveConfig = { version: row.version, config: gameConfigSchema.parse(withDefaults(row.data)) };
    await this.redis.set(REDIS_KEY, JSON.stringify(value));
    return value;
  }
}
