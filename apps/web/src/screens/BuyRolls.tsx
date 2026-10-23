import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Coin, Sheet, useToast } from '../components/ui';
import { formatNumber } from '../format';
import { useApiError, useMe, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { sound } from '../sound';
import { haptic, openInvoice } from '../telegram';

/** Покупка попыток: за Фишки или пакетами за Telegram Stars. */
export function BuyRollsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = useApiError();
  const patchBalance = usePatchBalance();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const cost = count * me.economy.rollCostChips;

  async function buyForChips() {
    setBusy(true);
    try {
      patchBalance(await api.buyRolls(count));
      sound.coin();
      haptic.notify('success');
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function buyForStars(packId: string) {
    setBusy(true);
    try {
      const { link } = await api.invoice(packId);
      const status = await openInvoice(link);
      if (status === 'paid') {
        // Попытки начисляет бот после successful_payment — даём ему пару секунд.
        toast(t('buy.pending'));
        const before = me!.rolls;
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const fresh = await qc.fetchQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 0 });
          if (fresh.rolls > before) break;
        }
        haptic.notify('success');
        toast(t('buy.paid'));
        onClose();
      }
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('buy.title')}>
      <div className="stack">
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row between">
            <b>{t('buy.forChips')}</b>
            <Coin value={me.chips} />
          </div>
          <div className="row between">
            <div className="row">
              <button className="btn btn-sm" onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
              <b style={{ minWidth: 28, textAlign: 'center' }}>{count}</b>
              <button className="btn btn-sm" onClick={() => setCount((c) => Math.min(10, c + 1))}>+</button>
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy || me.chips < cost} onClick={buyForChips}>
              {t('buy.count', { n: count, cost: formatNumber(cost) })}
            </button>
          </div>
        </div>

        <div className="card stack" style={{ gap: 8 }}>
          <b>{t('buy.forStars')}</b>
          {me.starPacks.map((p) => (
            <button key={p.id} className="btn row between" disabled={busy} onClick={() => buyForStars(p.id)}>
              <span>🎰 {t('buy.pack', { n: p.rolls })}</span>
              <span>⭐ {p.stars}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
