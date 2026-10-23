import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { BalanceDto, MeDto } from '@nomer/shared';
import { ApiError, api } from './api';
import { useToast } from './components/ui';
import { errorText, useT } from './i18n';
import { haptic } from './telegram';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 15_000 });
}

/** Обновляет баланс в кеше /me без лишнего запроса. */
export function usePatchBalance() {
  const qc = useQueryClient();
  return useCallback(
    (b: Partial<BalanceDto & Pick<MeDto, 'freeRollAt'>>) =>
      qc.setQueryData<MeDto>(['me'], (me) => (me ? { ...me, ...b } : me)),
    [qc],
  );
}

/**
 * Действие с кнопкой: пока выполняется — busy, ошибка API показывается тостом.
 * Возвращает [busy, run]; run(fn) не запускает второе действие поверх первого.
 */
export function useAction(): [boolean, (fn: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const onError = useApiError();
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        onError(e);
      } finally {
        setBusy(false);
      }
    },
    [busy, onError],
  );
  return [busy, run];
}

/** Показ ошибки API тостом с вибрацией. */
export function useApiError() {
  const toast = useToast();
  const { locale } = useT();
  return useCallback(
    (e: unknown) => {
      haptic.notify('error');
      if (e instanceof ApiError) toast(errorText(locale, e.code, e.message), 'error');
      else toast(e instanceof Error ? e.message : String(e), 'error');
    },
    [toast, locale],
  );
}
