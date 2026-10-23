import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  COMBO_NAMES,
  carModelTitle,
  marketSettlement,
  type CarCardDto,
  type CarDto,
  type PlateDto,
} from '@nomer/shared';
import { api } from '../api';
import { CarView } from '../components/CarView';
import { CarTile, ClassBadge, ComboChips, StatBars, useCarsConfig, useExclusiveColors } from '../components/cars';
import { Plate } from '../components/Plate';
import { Avatar, Coin, EmptyState, LoadMore, Sheet, Skeleton, TierBadge, useToast } from '../components/ui';
import { formatDate, formatDuration, formatNumber, useCountdown } from '../format';
import { useAction, useMe, usePatchBalance } from '../hooks';
import { useT, type TKey } from '../i18n';
import { useMainButton, useNav } from '../nav';
import { sound } from '../sound';
import { confirmDialog, haptic, openInvoice } from '../telegram';

/** Вкладка «Машины» в гараже: боксы с машинами, свободные места, сбор дохода покатушек. */
export function CarsGarage() {
  const { t } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const cars = useQuery({ queryKey: ['cars'], queryFn: api.cars });
  const [busy, run] = useAction();

  if (!cars.data) {
    return (
      <div className="bays">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} h={190} r={12} />
        ))}
      </div>
    );
  }
  const { garage, totalValue } = cars.data;
  const back = cars.data.cars.filter((c) => c.trip?.finished && !c.trip.collected);
  const backIncome = back.reduce((s, c) => s + (c.trip?.income ?? 0), 0);
  const free = Math.max(0, garage.slots - garage.used);

  const collect = () =>
    run(async () => {
      const res = await api.collectTrips();
      patchBalance({ chips: res.chips });
      sound.coin();
      haptic.notify('success');
      toast(t('garage.collected', { n: formatNumber(res.income) }));
      await qc.invalidateQueries({ queryKey: ['cars'] });
    });

  const buySlot = () =>
    run(async () => {
      const res = await api.buyGarageSlot();
      patchBalance({ chips: res.chips });
      haptic.notify('success');
      toast(t('garage.slotBought'));
      await qc.invalidateQueries({ queryKey: ['cars'] });
    });

  const buySlotStars = () =>
    run(async () => {
      const { link } = await api.itemInvoice({ kind: 'garage_slot' });
      const status = await openInvoice(link);
      if (status === 'paid') {
        toast(t('garage.slotBought'));
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['cars'] }), 1500);
      }
    });

  return (
    <div className="stack">
      <div className="muted small">
        {t('garage.carsSummary', { n: garage.used, slots: garage.slots, v: formatNumber(totalValue) })}
      </div>

      {back.length > 0 && (
        <button className="btn btn-success btn-block" disabled={busy} onClick={collect}>
          🏁 {t('garage.collect', { n: formatNumber(backIncome) })}
        </button>
      )}

      {cars.data.cars.length === 0 && <EmptyState text={t('garage.carsEmpty')} />}

      <div className="bays">
        {cars.data.cars.map((c) => (
          <CarTile key={c.id} car={c} onClick={() => nav.push({ name: 'car', id: c.id })} />
        ))}
        {Array.from({ length: Math.min(free, 4) }, (_, i) => (
          <button key={`free-${i}`} className="bay-empty" onClick={() => nav.push({ name: 'showroom' })}>
            <span className="plus">+</span>
            {t('garage.emptyBox')}
          </button>
        ))}
      </div>

      {garage.nextSlot && (
        <div className="card row between" style={{ flexWrap: 'wrap' }}>
          <span className="small muted">{free === 0 ? t('garage.full') : t('showroom.garage', { used: garage.used, slots: garage.slots })}</span>
          <div className="row">
            <button className="btn btn-sm btn-soft" disabled={busy} onClick={buySlot}>
              {t('garage.buySlot', { n: formatNumber(garage.nextSlot.chips) })}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={buySlotStars}>
              {t('garage.buySlotStars', { n: garage.nextSlot.stars })}
            </button>
          </div>
        </div>
      )}
      <button className="btn btn-primary btn-block" onClick={() => nav.push({ name: 'showroom' })}>
        🚘 {t('garage.toShowroom')}
      </button>
    </div>
  );
}

export function CarCardScreen({ id }: { id: string }) {
  const { t, locale } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const exclusive = useExclusiveColors();
  const { data: config } = useCarsConfig();
  const { data: me } = useMe();
  const card = useQuery({ queryKey: ['car', id], queryFn: () => api.car(id) });
  const [busy, run] = useAction();
  const [plateOpen, setPlateOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  const data = card.data;
  const car = data?.car;
  const mine = Boolean(car && me && car.ownerId === me.user.id);
  const listing = car?.listing ?? null;
  const canBuy = Boolean(car && listing && !mine);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['car', id] }),
      qc.invalidateQueries({ queryKey: ['cars'] }),
      qc.invalidateQueries({ queryKey: ['garage'] }),
      qc.invalidateQueries({ queryKey: ['carMarket'] }),
    ]);
  };

  const buy = () =>
    run(async () => {
      if (!car || !listing) return;
      const ok = await confirmDialog(t('car.buyConfirm', { car: carModelTitle(car.model), n: formatNumber(listing.price) }));
      if (!ok) return;
      const res = await api.buyCarListing(listing.id);
      patchBalance({ chips: res.chips });
      sound.coin();
      haptic.notify('success');
      toast(t('car.bought'));
      await refresh();
    });

  const nativeMain = useMainButton(
    canBuy && listing ? { text: t('car.buy', { n: formatNumber(listing.price) }), onClick: buy, progress: busy } : null,
  );

  if (!data || !car || !me || !config) {
    return (
      <div className="screen stack">
        <Skeleton h={220} r={12} />
        <Skeleton h={160} r={12} />
      </div>
    );
  }

  const sellPrice = Math.floor((car.model.priceChips * config.cars.sellBackPercent) / 100);
  const fee = config.cars.plateMount.removeFeeChips;

  const sell = () =>
    run(async () => {
      if (!(await confirmDialog(t('car.sellConfirm', { n: formatNumber(sellPrice) })))) return;
      const res = await api.sellCar(car.id);
      patchBalance({ chips: res.chips });
      sound.coin();
      toast(t('car.sold', { n: formatNumber(res.received) }));
      await refresh();
      nav.back();
    });

  const unmount = () =>
    run(async () => {
      if (!(await confirmDialog(t('car.unmountConfirm', { n: fee })))) return;
      await api.unmountPlate(car.id);
      haptic.notify('success');
      await refresh();
      void qc.invalidateQueries({ queryKey: ['me'] });
    });

  const unlist = () =>
    run(async () => {
      await api.cancelCarListing(listing!.id);
      haptic.notify('success');
      await refresh();
    });

  return (
    <div className="screen stack">
      <div className="stage" style={{ ['--stage-color' as string]: `var(--tier-${car.plate?.tier ?? 'common'})` }}>
        <div className="row between">
          <b>{carModelTitle(car.model)}</b>
          <ClassBadge carClass={car.model.class} />
        </div>
        <CarView archetype={car.model.archetype} tuning={car.tuning} exclusiveColors={exclusive} />
        {car.plate ? (
          <button style={{ display: 'block', width: '70%', margin: '4px auto 0' }} onClick={() => nav.push({ name: 'plate', id: car.plate!.id })}>
            <Plate plate={car.plate} tier={car.plate.tier} />
          </button>
        ) : (
          <div className="center muted small">{t('car.noPlate')}</div>
        )}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {car.plate && <TierBadge tier={car.plate.tier} />}
          {car.serial !== null && car.model.editionSize !== null && (
            <span className="tier-badge" style={{ ['--c' as string]: 'var(--tier-mythic)' }}>
              {t('car.edition', { n: car.serial, total: car.model.editionSize })}
            </span>
          )}
          {car.badges.map((b) => (
            <span key={b} className="tier-badge" style={{ ['--c' as string]: 'var(--tier-legendary)' }}>
              {badgeText(b, t)}
            </span>
          ))}
          {car.busy && <span className={`busy-dot busy-${car.busy}`}>{t(`busy.${car.busy}` as TKey)}</span>}
        </div>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <span className="muted">{t('car.value')}</span>
          <Coin value={car.value} />
        </div>
        <div className="row between">
          <span className="muted">{t('car.prestige')}</span>
          <b>{car.prestige}</b>
        </div>
        <div className="row between">
          <span className="muted">{t('car.rating')}</span>
          <b>{car.raceRating}</b>
        </div>
        {car.plate && (
          <div className="row between">
            <span className="muted">{t('trip.title')}</span>
            <span>{t('car.income', { n: formatNumber(car.tripHourlyIncome) })}</span>
          </div>
        )}
        <div className="divider" />
        <span className="muted small">{t('car.combos')}</span>
        {car.combos.length > 0 ? (
          <div className="stack" style={{ gap: 6 }}>
            <ComboChips combos={car.combos} />
            <span className="muted small">{car.combos.map((c) => COMBO_NAMES[locale][c].hint).join(' · ')}</span>
          </div>
        ) : (
          <span className="small">{t('car.noCombos')}</span>
        )}
      </div>

      <div className="card">
        <div className="panel-title">
          <span>{t('car.stats')}</span>
        </div>
        <StatBars stats={car.stats} base={car.model.stats} />
      </div>

      {mine && <TripPanel car={car} onChanged={refresh} />}

      <div className="stack" style={{ gap: 8 }}>
        {mine && !listing && (
          <>
            <PlateControls car={car} busy={busy} fee={fee} onMount={() => setPlateOpen(true)} onUnmount={unmount} />
            <button className="btn btn-block btn-soft" disabled={Boolean(car.busy)} onClick={() => nav.push({ name: 'tuning', carId: car.id })}>
              🔧 {t('car.tuning')}
            </button>
            <button className="btn btn-block" disabled={busy || Boolean(car.busy)} onClick={() => setListOpen(true)}>
              {t('car.list')}
            </button>
            <button className="btn btn-block" disabled={busy || Boolean(car.busy)} onClick={sell}>
              {t('car.sell', { n: formatNumber(sellPrice) })}
            </button>
          </>
        )}
        {mine && listing && (
          <>
            <div className="note warn">{t('car.listed', { n: formatNumber(listing.price) })}</div>
            <button className="btn btn-block btn-danger" disabled={busy} onClick={unlist}>
              {t('car.unlist')}
            </button>
          </>
        )}
        {canBuy && !nativeMain && (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={buy}>
            {t('car.buy', { n: formatNumber(listing!.price) })}
          </button>
        )}
      </div>

      <CarHistory data={data} />

      {mine && (
        <>
          <PlatePickerSheet open={plateOpen} onClose={() => setPlateOpen(false)} car={car} onDone={refresh} />
          <CarListSheet
            open={listOpen}
            onClose={() => setListOpen(false)}
            car={car}
            onDone={async () => {
              setListOpen(false);
              await refresh();
            }}
          />
        </>
      )}
    </div>
  );
}

function badgeText(badge: string, t: ReturnType<typeof useT>['t']): string {
  if (badge === 'mesalliance') return t('car.badge.mesalliance');
  const [, , place] = badge.split(':');
  return t('car.badge.exhibition', { place: place ?? '' });
}

function PlateControls(props: { car: CarDto; busy: boolean; fee: number; onMount: () => void; onUnmount: () => void }) {
  const { t } = useT();
  const { car } = props;
  const cooldown = useCountdown(car.plateChangeAt);
  const locked = Boolean(car.busy) || (cooldown !== null && cooldown > 0);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {cooldown !== null && cooldown > 0 && (
        <div className="note info">{t('car.cooldown', { time: formatDuration(cooldown) })}</div>
      )}
      <div className="row">
        <button className="btn btn-primary grow" disabled={props.busy || locked} onClick={props.onMount}>
          {car.plate ? t('car.change') : t('car.mount')}
        </button>
        {car.plate && (
          <button className="btn grow" disabled={props.busy || locked} onClick={props.onUnmount}>
            {t('car.unmount', { n: props.fee })}
          </button>
        )}
      </div>
    </div>
  );
}

/** Покатушки: старт на выбранное время, таймер возвращения, сбор дохода. */
function TripPanel({ car, onChanged }: { car: CarDto; onChanged: () => Promise<void> }) {
  const { t } = useT();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const { data: config } = useCarsConfig();
  const [busy, run] = useAction();
  const trip = car.trip;
  const left = useCountdown(trip && !trip.finished ? trip.endsAt : null);
  if (!config) return null;

  const start = (hours: number) =>
    run(async () => {
      await api.startTrip(car.id, hours);
      haptic.notify('success');
      toast(t('trip.started'));
      await onChanged();
    });

  const collect = () =>
    run(async () => {
      const res = await api.collectTrips();
      patchBalance({ chips: res.chips });
      sound.coin();
      toast(t('garage.collected', { n: formatNumber(res.income) }));
      await onChanged();
    });

  const pending = trip && trip.finished && !trip.collected;
  const onTrip = trip && !trip.finished;

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="panel-title" style={{ marginBottom: 0 }}>
        <span>🛣️ {t('trip.title')}</span>
      </div>
      {onTrip ? (
        <div className="note info">{t('trip.returnsIn', { time: formatDuration(left ?? 0) })}</div>
      ) : pending ? (
        <>
          <div className="row between">
            <b>{t('trip.back', { n: formatNumber(trip.income ?? 0) })}</b>
            {trip.event && (
              <span className="small" style={{ color: trip.event.delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {trip.event.title} ({trip.event.delta >= 0 ? '+' : ''}
                {trip.event.delta})
              </span>
            )}
          </div>
          <button className="btn btn-success btn-block" disabled={busy} onClick={collect}>
            {t('trip.collect', { n: formatNumber(trip.income ?? 0) })}
          </button>
        </>
      ) : (
        <>
          <div className="muted small">{t('trip.text')}</div>
          {car.plate ? (
            <div className="row">
              {config.cars.trips.durations.map((d) => (
                <button key={d.hours} className="btn btn-soft grow" disabled={busy || Boolean(car.busy)} onClick={() => start(d.hours)}>
                  {t('trip.go', { h: d.hours, n: formatNumber(Math.round(car.tripHourlyIncome * d.hours * d.efficiency)) })}
                </button>
              ))}
            </div>
          ) : (
            <div className="note warn">{t('trip.needPlate')}</div>
          )}
        </>
      )}
    </div>
  );
}

/** Выбор номера из гаража; номера, дающие комбо с этой машиной, подписаны. */
function PlatePickerSheet(props: { open: boolean; onClose: () => void; car: CarDto; onDone: () => Promise<void> }) {
  const { t, locale } = useT();
  const { data: config } = useCarsConfig();
  const [busy, run] = useAction();
  const toast = useToast();
  const list = useInfiniteQuery({
    queryKey: ['garage', 'me', { sort: 'value_desc' }],
    queryFn: ({ pageParam }) => api.garage({ sort: 'value_desc' }, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: props.open,
  });
  const free = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !p.carId && !p.listing);
  const statusTier = config?.cars.combos.status.tierByClass[props.car.model.class];

  const pick = (plate: PlateDto) =>
    run(async () => {
      await api.mountPlate(props.car.id, plate.id);
      haptic.notify('success');
      sound.coin();
      toast(t('car.mounted'));
      props.onClose();
      await props.onDone();
    });

  return (
    <Sheet open={props.open} onClose={props.onClose} title={t('car.pickPlate')}>
      <div className="stack">
        {props.car.plate && config && <div className="note warn">{t('car.changeFee', { n: config.cars.plateMount.removeFeeChips })}</div>}
        {list.isPending ? (
          <Skeleton h={120} />
        ) : free.length === 0 ? (
          <EmptyState text={t('car.noFreePlates')} />
        ) : (
          <div className="grid">
            {free.map((p) => {
              const hints = [
                p.tier === statusTier ? COMBO_NAMES[locale].status.title : null,
                props.car.model.styleNumbers.includes(p.number) ? COMBO_NAMES[locale].style.title : null,
              ].filter(Boolean);
              return (
                <div key={p.id} className="stack" style={{ gap: 4 }}>
                  <button className="tile" disabled={busy} style={{ ['--c' as string]: `var(--tier-${p.tier})` }} onClick={() => pick(p)}>
                    <Plate plate={p} />
                    <div className="row between">
                      <TierBadge tier={p.tier} />
                      <span className="muted small">{formatNumber(p.value)}</span>
                    </div>
                    {hints.length > 0 && (
                      <div className="row" style={{ gap: 4 }}>
                        {hints.map((h) => (
                          <span key={h} className="combo-chip">{h}</span>
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
      </div>
    </Sheet>
  );
}

function CarListSheet(props: { open: boolean; onClose: () => void; car: CarDto; onDone: () => Promise<void> }) {
  const { t } = useT();
  const { data: me } = useMe();
  const toast = useToast();
  const [price, setPrice] = useState(String(props.car.value));
  const [busy, run] = useAction();
  if (!me) return null;
  const value = Number(price) || 0;
  const { sellerReceives } = marketSettlement(value, me.economy.marketFeePercent);
  const valid = value >= me.economy.minListingPrice && value <= me.economy.maxListingPrice;

  const submit = () =>
    run(async () => {
      await api.createCarListing(props.car.id, value);
      haptic.notify('success');
      toast(t('list.done'));
      await props.onDone();
    });

  return (
    <Sheet open={props.open} onClose={props.onClose} title={t('car.list')}>
      <div className="stack">
        {props.car.plate && <div className="note info">{t('car.listWithPlate')}</div>}
        <label className="stack" style={{ gap: 6 }}>
          <span className="muted small">{t('list.price')}</span>
          <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="muted small">{t('list.fee', { p: me.economy.marketFeePercent, n: formatNumber(sellerReceives) })}</div>
        <button className="btn btn-primary btn-block" disabled={!valid || busy} onClick={submit}>
          {t('list.submit')}
        </button>
      </div>
    </Sheet>
  );
}

function CarHistory({ data }: { data: CarCardDto }) {
  const { t, locale } = useT();
  return (
    <div className="card">
      <div className="row between">
        <b>{t('car.history')}</b>
        {data.recordPrice !== null && <span className="muted small">{t('car.record', { n: formatNumber(data.recordPrice) })}</span>}
      </div>
      {data.history.map((h, i) => (
        <div key={i} className="list-row">
          <Avatar user={h.owner} size={28} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{h.owner.name}</div>
            <div className="muted small">
              {t(`via.${h.acquiredVia}` as TKey)} · {formatDate(h.acquiredAt, locale)}
              {h.releasedAt ? ` — ${formatDate(h.releasedAt, locale)}` : ''}
            </div>
          </div>
          {h.acquiredPrice !== null && <Coin value={h.acquiredPrice} />}
        </div>
      ))}
    </div>
  );
}
