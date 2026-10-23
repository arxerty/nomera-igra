import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TIER_COLORS, formatPlate } from '@nomer/shared';
import { api } from '../api';
import { Plate } from '../components/Plate';
import { Avatar, Coin, EmptyState, Skeleton, TierBadge, useToast } from '../components/ui';
import { formatDuration, formatNumber, useCountdown } from '../format';
import { useAction, useMe, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { sound } from '../sound';
import { confirmDialog, haptic } from '../telegram';

export function AuctionScreen() {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['auction'], queryFn: api.auction, refetchInterval: 5000 });
  const lot = q.data?.auction ?? null;
  const serverOffset = me ? Date.parse(me.serverTime) - Date.now() : 0;
  const left = useCountdown(lot?.status === 'active' ? lot.endsAt : null, serverOffset);
  const [custom, setCustom] = useState('');
  const [busy, run] = useAction();

  if (q.isPending) {
    return (
      <div className="screen stack">
        <Skeleton h={200} r={12} />
        <Skeleton h={160} r={12} />
      </div>
    );
  }

  const bid = (amount: number) =>
    run(async () => {
      if (!lot) return;
      if (!(await confirmDialog(`${formatPlate(lot.plate)} — ${t('auction.bid', { n: formatNumber(amount) })}?`))) return;
      const updated = await api.bid(lot.id, amount);
      qc.setQueryData(['auction'], { auction: updated });
      patchBalance({ chips: (await api.me()).chips });
      sound.coin();
      haptic.notify('success');
      toast(t('auction.bidDone'));
      setCustom('');
    });

  const active = lot?.status === 'active' && (left ?? 1) > 0;
  const quick = lot ? [lot.minNextBid, Math.ceil((lot.minNextBid * 1.1) / 10) * 10, Math.ceil((lot.minNextBid * 1.5) / 10) * 10] : [];
  const customValue = Number(custom) || 0;

  return (
    <div className="screen stack">
      <div>
        <div className="screen-title">🔨 {t('auction.title')}</div>
        <div className="muted small">{t('auction.text')}</div>
      </div>
      {!lot ? (
        <EmptyState text={t('auction.none')} />
      ) : (
        <>
          <div className="stage" style={{ ['--stage-color' as string]: TIER_COLORS[lot.plate.tier] }}>
            <Plate plate={lot.plate} tier={lot.plate.tier} />
            <div className="row between" style={{ marginTop: 12 }}>
              <TierBadge tier={lot.plate.tier} />
              <b>{active ? t('auction.endsIn', { time: formatDuration(left ?? 0) }) : t('auction.ended')}</b>
            </div>
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <span className="muted">{t('auction.current')}</span>
              {lot.currentBid !== null ? <Coin value={lot.currentBid} /> : <span className="muted">{t('auction.noBids')}</span>}
            </div>
            <div className="row between">
              <span className="muted">{t('auction.leader')}</span>
              {lot.leader ? (
                <span className="row">
                  <Avatar user={lot.leader} size={22} />
                  {lot.leader.name}
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
            <span className="muted small">{t('auction.start', { n: formatNumber(lot.startPrice) })}</span>
            {lot.isLeader && <div className="note info">{t('auction.youLead')}</div>}
            {!active && lot.status === 'settled' && lot.leader && (
              <div className="note info">{t('auction.winner', { name: lot.leader.name })}</div>
            )}
            {!active && lot.status === 'unsold' && <div className="note warn">{t('auction.unsold')}</div>}
          </div>

          {active && !lot.isLeader && (
            <div className="card stack" style={{ gap: 8 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {quick.map((n) => (
                  <button key={n} className="btn btn-primary grow" disabled={busy} onClick={() => bid(n)}>
                    {t('auction.bid', { n: formatNumber(n) })}
                  </button>
                ))}
              </div>
              <div className="row">
                <input
                  className="grow"
                  inputMode="numeric"
                  placeholder={formatNumber(lot.minNextBid)}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
                />
                <button className="btn btn-soft" disabled={busy || customValue < lot.minNextBid} onClick={() => bid(customValue)}>
                  {t('auction.bid', { n: '' }).trim()}
                </button>
              </div>
              <span className="muted small">{t('auction.hold')}</span>
            </div>
          )}

          <div className="card" style={{ padding: '4px 14px' }}>
            <div className="panel-title" style={{ margin: '10px 0 0' }}>
              <span>{t('auction.bids')}</span>
            </div>
            {lot.bids.length === 0 ? (
              <div className="muted small" style={{ padding: 12 }}>{t('auction.noBids')}</div>
            ) : (
              lot.bids.map((b, i) => (
                <div key={i} className="list-row">
                  <Avatar user={b.user} size={26} />
                  <span className="grow">{b.user.name}</span>
                  <Coin value={b.amount} />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
