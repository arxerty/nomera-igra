import { randomInt } from 'node:crypto';
import type { Rng } from '@nomer/shared';

/** Криптостойкий источник случайности для боевых выбиваний. */
export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(maxExclusive),
};
