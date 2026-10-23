import { describe, expect, it } from 'vitest';
import { InitDataError, signInitData, validateInitData } from '../src/lib/telegram-auth';

const TOKEN = '123456:TEST-bot-token-for-unit-tests';
const now = new Date('2026-10-20T12:00:00Z');
const authDate = String(Math.floor(now.getTime() / 1000) - 60);
const user = JSON.stringify({ id: 42, first_name: 'Иван', username: 'ivan', language_code: 'ru' });

describe('validateInitData', () => {
  it('принимает корректно подписанные данные', () => {
    const initData = signInitData({ auth_date: authDate, user, start_param: 'ref_7', query_id: 'AAA' }, TOKEN);
    const res = validateInitData(initData, TOKEN, 3600, now);
    expect(res.user.id).toBe(42);
    expect(res.user.first_name).toBe('Иван');
    expect(res.startParam).toBe('ref_7');
  });

  it('отклоняет подделанное поле', () => {
    const initData = signInitData({ auth_date: authDate, user }, TOKEN);
    const tampered = initData.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(tampered).not.toBe(initData);
    expect(() => validateInitData(tampered, TOKEN, 3600, now)).toThrow(InitDataError);
  });

  it('отклоняет подпись чужим токеном', () => {
    const initData = signInitData({ auth_date: authDate, user }, '999:other-token');
    expect(() => validateInitData(initData, TOKEN, 3600, now)).toThrow(/подпись/);
  });

  it('отклоняет устаревшие данные', () => {
    const old = String(Math.floor(now.getTime() / 1000) - 7200);
    const initData = signInitData({ auth_date: old, user }, TOKEN);
    expect(() => validateInitData(initData, TOKEN, 3600, now)).toThrow(/устарела/);
  });

  it('отклоняет данные без hash и без user', () => {
    expect(() => validateInitData(`auth_date=${authDate}`, TOKEN, 3600, now)).toThrow(InitDataError);
    const noUser = signInitData({ auth_date: authDate }, TOKEN);
    expect(() => validateInitData(noUser, TOKEN, 3600, now)).toThrow(/пользовател/);
  });

  it('учитывает поле signature в строке проверки (Bot API 8.0+)', () => {
    const initData = signInitData({ auth_date: authDate, user, signature: 'abc' }, TOKEN);
    expect(validateInitData(initData, TOKEN, 3600, now).user.id).toBe(42);
  });
});
