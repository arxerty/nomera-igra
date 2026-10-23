import { describe, expect, it } from 'vitest';
import { escapeHtml, localeOf, renderNotification } from '../src/texts';

describe('тексты бота', () => {
  it('localeOf', () => {
    expect(localeOf('ru')).toBe('ru');
    expect(localeOf('uk-UA')).toBe('ru');
    expect(localeOf('en')).toBe('en');
    expect(localeOf(undefined)).toBe('en');
  });

  it('экранирует HTML в именах игроков', () => {
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
    const { text } = renderNotification({
      type: 'trade_offer',
      telegramId: '1',
      locale: 'ru',
      code: 'abc',
      fromName: '<script>',
    });
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });

  it('уведомление об обмене ведёт на предложение', () => {
    const n = renderNotification({ type: 'trade_accepted', telegramId: '1', locale: 'en', code: 'XyZ', byName: 'Bob' });
    expect(n.startParam).toBe('trade_XyZ');
    expect(n.text).toContain('Bob');
  });

  it('продажа на рынке — суммы с разделителями', () => {
    const n = renderNotification({
      type: 'plate_sold',
      telegramId: '1',
      locale: 'ru',
      plate: 'А777АА 77',
      tier: 'legendary',
      price: 12000,
      received: 11400,
    });
    expect(n.text).toMatch(/12\s000/);
    expect(n.text).toMatch(/11\s400/);
  });
});
