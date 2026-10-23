import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { TradeOfferDto } from '@nomer/shared';
import { api } from '../api';
import { Avatar, Coin, EmptyState, LoadMore, PlateTile, Skeleton, useToast } from '../components/ui';
import { formatDate } from '../format';
import { useApiError, useMe } from '../hooks';
import { useT } from '../i18n';
import { useMainButton, useNav } from '../nav';
import { confirmDialog, haptic, openTelegramLink } from '../telegram';

export function TradesScreen() {
  const { t } = useT();
  const nav = useNav();
  const trades = useQuery({ queryKey: ['trades'], queryFn: api.trades });

  const section = (title: string, list: TradeOfferDto[] | undefined) => (
    <div className="stack" style={{ gap: 8 }}>
      <b>{title}</b>
      {!list ? (
        <Skeleton h={64} r={16} />
      ) : list.length === 0 ? (
        <EmptyState text={t('trades.empty')} />
      ) : (
        list.map((o) => (
          <button key={o.code} className="card row" style={{ textAlign: 'left' }} onClick={() => nav.push({ name: 'trade', code: o.code })}>
            <Avatar user={o.from} size={32} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{o.from.name}{o.to ? ` → ${o.to.name}` : ''}</div>
              <div className="muted small">
                {o.offered.length} ⇄ {o.requested.length}
                {o.offeredChips ? ` · +${o.offeredChips}` : ''}
                {o.requestedChips ? ` · −${o.requestedChips}` : ''}
              </div>
            </div>
            <span className="muted">›</span>
          </button>
        ))
      )}
    </div>
  );

  return (
    <div className="screen stack">
      <div className="screen-title">{t('trades.title')}</div>
      <button className="btn btn-primary btn-block" onClick={() => nav.push({ name: 'tradeCreate' })}>
        + {t('trade.create')}
      </button>
      {section(t('trades.incoming'), trades.data?.incoming)}
      {section(t('trades.outgoing'), trades.data?.outgoing)}
    </div>
  );
}

/** Просмотр предложения обмена (в том числе по ссылке startapp=trade_<code>). */
export function TradeScreen({ code }: { code: string }) {
  const { t, locale } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = useApiError();
  const { data: me } = useMe();
  const offer = useQuery({ queryKey: ['trade', code], queryFn: () => api.trade(code) });
  const [busy, setBusy] = useState(false);
  const o = offer.data;

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      haptic.notify('success');
      if (success) toast(success);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['trade', code] }),
        qc.invalidateQueries({ queryKey: ['trades'] }),
        qc.invalidateQueries({ queryKey: ['garage'] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ]);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const accept = async () => {
    if (await confirmDialog(t('trade.acceptConfirm'))) await run(() => api.acceptTrade(code), t('trade.accepted'));
  };
  const nativeMain = useMainButton(o?.canAccept ? { text: t('trade.accept'), onClick: accept, progress: busy } : null);

  if (!o || !me) {
    return (
      <div className="screen stack">
        <Skeleton h={80} r={16} />
        <Skeleton h={200} r={16} />
      </div>
    );
  }

  const isAuthor = o.from.id === me.user.id;
  const isTarget = o.to?.id === me.user.id;
  const share = () =>
    openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(o.link)}&text=${encodeURIComponent(t('trade.shareText'))}`);

  const side = (title: string, plates: TradeOfferDto['offered'], chips: number) => (
    <div className="card stack" style={{ gap: 8 }}>
      <b>{title}</b>
      {plates.length === 0 && chips === 0 && <span className="muted small">—</span>}
      <div className="grid">
        {plates.map((p) => (
          <PlateTile key={p.id} plate={p} onClick={() => nav.push({ name: 'plate', id: p.id })} />
        ))}
      </div>
      {chips > 0 && <Coin value={chips} />}
    </div>
  );

  return (
    <div className="screen stack">
      <div className="screen-title">{t('trade.title')}</div>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row between">
          <span className="muted">{t('trade.from')}</span>
          <span className="row"><Avatar user={o.from} size={22} />{o.from.name}</span>
        </div>
        <div className="row between">
          <span className="muted">{t('trade.to')}</span>
          <span>{o.to ? o.to.name : t('trade.anyone')}</span>
        </div>
        {o.message && <div className="small" style={{ fontStyle: 'italic' }}>«{o.message}»</div>}
        <div className="muted small">
          {o.status === 'pending' ? t('trade.expires', { date: formatDate(o.expiresAt, locale) }) : t(`trade.status.${o.status}`)}
        </div>
      </div>

      {side(t('trade.gives'), o.offered, o.offeredChips)}
      {side(t('trade.wants'), o.requested, o.requestedChips)}

      {o.status === 'pending' && (
        <div className="stack" style={{ gap: 8 }}>
          {o.canAccept && !nativeMain && (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={accept}>{t('trade.accept')}</button>
          )}
          {isTarget && (
            <button className="btn btn-block btn-danger" disabled={busy} onClick={() => run(() => api.declineTrade(code)).then(nav.back)}>
              {t('trade.decline')}
            </button>
          )}
          {isAuthor && (
            <>
              <button className="btn btn-primary btn-block" onClick={share}>{t('trade.share')}</button>
              <button className="btn btn-block btn-danger" disabled={busy} onClick={() => run(() => api.cancelTrade(code)).then(nav.back)}>
                {t('trade.cancel')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Создание предложения: выбор своих номеров, доплата, запрошенный номер. */
export function TradeCreateScreen({ offered = [], requested = [] }: { offered?: string[]; requested?: string[] }) {
  const { t } = useT();
  const nav = useNav();
  const onError = useApiError();
  const [selected, setSelected] = useState<string[]>(offered);
  const [offerChips, setOfferChips] = useState('');
  const [requestChips, setRequestChips] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const requestedCard = useQuery({
    queryKey: ['plate', requested[0]],
    queryFn: () => api.plate(requested[0]!),
    enabled: requested.length > 0,
  });
  const garage = useInfiniteQuery({
    queryKey: ['garage', 'me', { sort: 'value_desc' }],
    queryFn: ({ pageParam }) => api.garage({ sort: 'value_desc' }, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const mine = (garage.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !p.listing);

  const toggle = (id: string) => {
    haptic.select();
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 10 ? [...s, id] : s));
  };

  async function submit() {
    setBusy(true);
    try {
      const res = await api.createTrade({
        offeredPlateIds: selected,
        requestedPlateIds: requested,
        offeredChips: Number(offerChips) || 0,
        requestedChips: Number(requestChips) || 0,
        message: message.trim() || undefined,
      });
      haptic.notify('success');
      nav.back();
      nav.push({ name: 'trade', code: res.code });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = selected.length + requested.length > 0 && !busy;
  const nativeMain = useMainButton({ text: t('trade.submit'), onClick: submit, disabled: !canSubmit, progress: busy });

  return (
    <div className="screen stack">
      <div className="screen-title">{t('trade.create')}</div>

      {requested.length > 0 && (
        <div className="card stack" style={{ gap: 8 }}>
          <b>{t('trade.requested')}</b>
          {requestedCard.data ? <PlateTile plate={requestedCard.data.plate} /> : <Skeleton h={70} />}
        </div>
      )}

      <div className="card stack" style={{ gap: 8 }}>
        <b>{t('trade.pickOffer')}</b>
        <div className="grid">
          {mine.map((p) => (
            <PlateTile key={p.id} plate={p} selected={selected.includes(p.id)} onClick={() => toggle(p.id)} />
          ))}
        </div>
        <LoadMore hasMore={Boolean(garage.hasNextPage)} loading={garage.isFetchingNextPage} onLoad={() => void garage.fetchNextPage()} />
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">{t('trade.offerChips')}</span>
          <input inputMode="numeric" value={offerChips} onChange={(e) => setOfferChips(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">{t('trade.requestChips')}</span>
          <input inputMode="numeric" value={requestChips} onChange={(e) => setRequestChips(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">{t('trade.message')}</span>
          <input maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>

      {!nativeMain && (
        <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={submit}>
          {t('trade.submit')}
        </button>
      )}
    </div>
  );
}
