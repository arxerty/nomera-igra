import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  BONUS_NAMES,
  TIER_COLORS,
  TRAIT_NAMES,
  formatPlate,
  getRegion,
  marketSettlement,
  type PlateCardDto,
} from '@nomer/shared';
import { api } from '../api';
import { Plate } from '../components/Plate';
import { Avatar, Coin, Sheet, Skeleton, TierBadge, useToast } from '../components/ui';
import { formatDate, formatNumber } from '../format';
import { useApiError, useMe, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { useMainButton, useNav } from '../nav';
import { sound } from '../sound';
import { confirmDialog, haptic, shareInline } from '../telegram';

export function PlateCardScreen({ id }: { id: string }) {
  const { t, locale } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = useApiError();
  const patchBalance = usePatchBalance();
  const { data: me } = useMe();
  const card = useQuery({ queryKey: ['plate', id], queryFn: () => api.plate(id) });
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const data = card.data;
  const mine = Boolean(data && me && data.owner?.id === me.user.id);
  const listing = data?.plate.listing ?? null;
  const canBuy = Boolean(data && me && listing && !mine);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['plate', id] });
    void qc.invalidateQueries({ queryKey: ['garage'] });
    void qc.invalidateQueries({ queryKey: ['market'] });
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const buy = () =>
    run(async () => {
      if (!data || !listing) return;
      const ok = await confirmDialog(t('plate.buyConfirm', { plate: formatPlate(data.plate), n: formatNumber(listing.price) }));
      if (!ok) return;
      const res = await api.buyListing(listing.id);
      patchBalance({ chips: res.chips });
      sound.coin();
      haptic.notify('success');
      toast(t('plate.bought'));
      refresh();
    });

  const nativeMain = useMainButton(
    canBuy && listing ? { text: t('plate.buy', { n: formatNumber(listing.price) }), onClick: buy, progress: busy } : null,
  );

  if (!data || !me) return <PlateCardSkeleton />;
  const { plate } = data;

  const sell = () =>
    run(async () => {
      const ok = await confirmDialog(t('plate.sellConfirm', { plate: formatPlate(plate), n: formatNumber(plate.value) }));
      if (!ok) return;
      const res = await api.sellPlate(plate.id);
      patchBalance({ chips: res.chips });
      sound.coin();
      haptic.notify('success');
      toast(t('plate.sold', { n: formatNumber(res.received) }));
      refresh();
      nav.back();
    });

  const unlist = () =>
    run(async () => {
      await api.cancelListing(listing!.id);
      haptic.notify('success');
      refresh();
    });

  const region = getRegion(plate.region);

  return (
    <div className="screen stack">
      <div className="stage" style={{ ['--stage-color' as string]: TIER_COLORS[plate.tier] }}>
        <Plate plate={plate} tier={plate.tier} />
        <div className="row between" style={{ marginTop: 14 }}>
          <TierBadge tier={plate.tier} />
          <span className="muted small">{region?.name[locale] ?? plate.region}</span>
        </div>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <span className="muted">{t('plate.value')}</span>
          <Coin value={plate.value} />
        </div>
        {plate.traits.length > 0 && (
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <span className="muted">{t('plate.traits')}</span>
            <span style={{ textAlign: 'right' }}>{plate.traits.map((x) => TRAIT_NAMES[locale][x]).join(', ')}</span>
          </div>
        )}
        {plate.bonuses.length > 0 && (
          <div className="row between">
            <span className="muted">{t('plate.bonuses')}</span>
            <span style={{ color: 'var(--tier-legendary)' }}>{plate.bonuses.map((b) => `★ ${BONUS_NAMES[locale][b]}`).join(', ')}</span>
          </div>
        )}
        <div className="row between">
          <span className="muted">{t('plate.owner')}</span>
          {data.owner ? (
            <span className="row">
              <Avatar user={data.owner} size={22} />
              {data.owner.name}
            </span>
          ) : (
            <span className="muted small">{t('plate.noOwner')}</span>
          )}
        </div>
        {plate.acquiredAt && (
          <div className="row between">
            <span className="muted">{t('plate.acquired')}</span>
            <span>{formatDate(plate.acquiredAt, locale)}</span>
          </div>
        )}
        {listing && (
          <div className="row between">
            <span className="muted">{t('plate.listed', { n: '' }).trim()}</span>
            <Coin value={listing.price} />
          </div>
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {mine && !listing && (
          <>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => setListOpen(true)}>
              {t('plate.list')}
            </button>
            <button className="btn btn-block" disabled={busy} onClick={sell}>
              {t('plate.sell', { n: formatNumber(plate.value) })}
            </button>
            <button className="btn btn-block" onClick={() => nav.push({ name: 'tradeCreate', offered: [plate.id] })}>
              {t('plate.trade')}
            </button>
          </>
        )}
        {mine && listing && (
          <button className="btn btn-block btn-danger" disabled={busy} onClick={unlist}>
            {t('plate.unlist')}
          </button>
        )}
        {canBuy && !nativeMain && (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={buy}>
            {t('plate.buy', { n: formatNumber(listing!.price) })}
          </button>
        )}
        {!mine && data.owner && !listing && (
          <button className="btn btn-block" onClick={() => nav.push({ name: 'tradeCreate', requested: [plate.id] })}>
            {t('plate.trade')}
          </button>
        )}
        <button className="btn btn-block" onClick={() => shareInline(`plate ${plate.key}`) || toast(formatPlate(plate))}>
          {t('home.share')}
        </button>
      </div>

      <Passport data={data} />

      {mine && (
        <ListSheet
          open={listOpen}
          onClose={() => setListOpen(false)}
          plateId={plate.id}
          suggested={Math.max(me.economy.minListingPrice, plate.value * 2)}
          onDone={() => {
            setListOpen(false);
            toast(t('list.done'));
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Passport({ data }: { data: PlateCardDto }) {
  const { t, locale } = useT();
  return (
    <div className="card">
      <b>{t('plate.passport')}</b>
      <div className="muted small" style={{ margin: '4px 0 6px' }}>
        {t('plate.firstRolled', { date: formatDate(data.firstRolledAt, locale), n: data.rolledTimes })}
      </div>
      {data.passport.map((p, i) => (
        <div key={i} className="list-row">
          <Avatar user={p.owner} size={28} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{p.owner.name}</div>
            <div className="muted small">
              {t(`via.${p.acquiredVia}`)} · {formatDate(p.acquiredAt, locale)}
              {p.releasedAt ? ` — ${formatDate(p.releasedAt, locale)}` : ''}
            </div>
          </div>
          {p.acquiredPrice !== null && <Coin value={p.acquiredPrice} />}
        </div>
      ))}
    </div>
  );
}

function ListSheet(props: { open: boolean; onClose: () => void; plateId: string; suggested: number; onDone: () => void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const onError = useApiError();
  const [price, setPrice] = useState(String(props.suggested));
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const value = Number(price) || 0;
  const { sellerReceives } = marketSettlement(value, me.economy.marketFeePercent);
  const valid = value >= me.economy.minListingPrice && value <= me.economy.maxListingPrice;

  async function submit() {
    setBusy(true);
    try {
      await api.createListing(props.plateId, value);
      haptic.notify('success');
      props.onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={props.open} onClose={props.onClose} title={t('list.title')}>
      <div className="stack">
        <label className="stack" style={{ gap: 6 }}>
          <span className="muted small">{t('list.price')}</span>
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="muted small">
          {t('list.fee', { p: me.economy.marketFeePercent, n: formatNumber(sellerReceives) })}
        </div>
        <button className="btn btn-primary btn-block" disabled={!valid || busy} onClick={submit}>
          {t('list.submit')}
        </button>
      </div>
    </Sheet>
  );
}

function PlateCardSkeleton() {
  return (
    <div className="screen stack">
      <Skeleton h={160} r={22} />
      <Skeleton h={140} r={16} />
      <Skeleton h={46} r={10} />
    </div>
  );
}
