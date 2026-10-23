import type { PaymentJob, PlateCardDto } from '@nomer/shared';
import type { Env } from './env';

export class InternalApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Клиент внутренних эндпоинтов API (/internal/*). */
export function createInternalApi(env: Env) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${env.API_INTERNAL_URL}/internal${path}`, {
      method,
      headers: {
        'x-internal-token': env.INTERNAL_API_TOKEN,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
    if (!res.ok) throw new InternalApiError(res.status, json?.error?.message ?? `HTTP ${res.status}`);
    return json as T;
  }

  return {
    preCheckout: (e: { payload: string; telegramUserId: string; currency: string; totalAmount: number }) =>
      call<{ ok: true } | { ok: false; error: string }>('POST', '/payments/pre-checkout', e),
    confirmPayment: (p: Omit<PaymentJob, 'chatId' | 'locale'>) =>
      call<{ ok: true; duplicate: boolean; rolls: number; kind: 'rolls' | 'car' | 'paint' | 'garage_slot'; refunded: boolean }>(
        'POST',
        '/payments/success',
        p,
      ),
    plate: (key: string) => call<PlateCardDto>('GET', `/plates/${encodeURIComponent(key)}`),
    setBlocked: (telegramId: string, blocked: boolean) =>
      call<{ ok: true }>('POST', `/users/${telegramId}/blocked`, { blocked }),
  };
}

export type InternalApi = ReturnType<typeof createInternalApi>;
