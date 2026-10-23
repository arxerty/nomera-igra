import type { Redis } from 'ioredis';
import { AppError } from './errors';

const tooFast = () => new AppError(429, 'rate_limited', 'Слишком часто, подождите немного');

/** Фиксированное окно: не больше `max` действий `name` за `windowSec` секунд для одного ключа. */
export async function hitRateLimit(redis: Redis, name: string, key: string, max: number, windowSec: number) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const redisKey = `rl:${name}:${key}:${bucket}`;
  const [[, count]] = (await redis.multi().incr(redisKey).expire(redisKey, windowSec).exec()) as [[null, number]];
  if (count > max) throw tooFast();
}

/** Кулдаун: действие `name` не чаще раза в `ms` миллисекунд (заодно отсекает дубли параллельных запросов). */
export async function hitCooldown(redis: Redis, name: string, key: string, ms: number) {
  const ok = await redis.set(`cd:${name}:${key}`, '1', 'PX', ms, 'NX');
  if (ok !== 'OK') throw tooFast();
}
