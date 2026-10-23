import { createHmac, timingSafeEqual } from 'node:crypto';

/** Пользователь из initData Telegram Mini App. */
export interface TelegramInitUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface ValidatedInitData {
  user: TelegramInitUser;
  authDate: Date;
  startParam: string | null;
  /** Вход в режиме разработки (без подписи Telegram): профиль существующего игрока не трогаем. */
  dev?: boolean;
}

export class InitDataError extends Error {}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function computeHash(params: URLSearchParams, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString(params)).digest('hex');
}

/**
 * Проверяет подпись initData по алгоритму Telegram:
 * secret = HMAC_SHA256("WebAppData", botToken), hash = HMAC_SHA256(secret, data_check_string).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  now: Date = new Date(),
): ValidatedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataError('Нет подписи initData');

  const expected = Buffer.from(computeHash(params, botToken), 'hex');
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), expected)) {
    throw new InitDataError('Неверная подпись initData');
  }

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataError('Нет auth_date');
  if (now.getTime() / 1000 - authDateSec > maxAgeSec) throw new InitDataError('initData устарела');

  const rawUser = params.get('user');
  if (!rawUser) throw new InitDataError('Нет пользователя в initData');
  let user: TelegramInitUser;
  try {
    user = JSON.parse(rawUser) as TelegramInitUser;
  } catch {
    throw new InitDataError('Некорректный user в initData');
  }
  if (!Number.isSafeInteger(user.id) || typeof user.first_name !== 'string') {
    throw new InitDataError('Некорректный user в initData');
  }

  return { user, authDate: new Date(authDateSec * 1000), startParam: params.get('start_param') };
}

/** Подписывает initData токеном бота. Для тестов и локальных скриптов. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  params.set('hash', computeHash(params, botToken));
  return params.toString();
}
