/** Минимальный клиент Bot API для вызовов из API-сервера. */
export async function callBotApi<T>(botToken: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Bot API ${method}: ${json.description ?? res.status}`);
  return json.result as T;
}

/** Ссылка на инвойс в Telegram Stars (currency XTR, provider_token пустой). */
export function createStarsInvoiceLink(
  botToken: string,
  args: { title: string; description: string; payload: string; stars: number; label: string },
): Promise<string> {
  return callBotApi<string>(botToken, 'createInvoiceLink', {
    title: args.title,
    description: args.description,
    payload: args.payload,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: args.label, amount: args.stars }],
  });
}
