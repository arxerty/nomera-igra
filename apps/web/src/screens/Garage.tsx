import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TIERS, TIER_COLORS, TIER_NAMES, getRegion, type Tier } from '@nomer/shared';
import { api, type GarageFilters, type GarageSort } from '../api';
import { CarTile } from '../components/cars';
import { EmptyState, LoadMore, PlateTile, PlateTileSkeleton, Segmented } from '../components/ui';
import { CarsGarage } from './Cars';
import { formatNumber } from '../format';
import { useT } from '../i18n';
import { useNav } from '../nav';

const SORTS: GarageSort[] = ['newest', 'value_desc', 'tier_desc', 'value_asc', 'oldest'];

type GarageView = 'plates' | 'cars';

/** Последняя открытая вкладка гаража — чтобы возврат со вложенного экрана не сбрасывал её. */
let lastView: GarageView = 'plates';
export function openGarageOn(view: GarageView) {
  lastView = view;
}

/** Гараж: свой (без userId) или чужой — из рейтинга. Вкладки «Номера» и «Машины». */
export function GarageScreen({ userId, title }: { userId?: string; title?: string }) {
  const { t } = useT();
  const [view, setView] = useState<GarageView>(userId ? 'plates' : lastView);
  const pick = (v: GarageView) => {
    if (!userId) lastView = v;
    setView(v);
  };
  return (
    <div className="screen stack">
      <div className="screen-title">{title ?? t('garage.title')}</div>
      <Segmented
        value={view}
        onChange={pick}
        options={[
          { value: 'plates', label: t('garage.plates') },
          { value: 'cars', label: t('garage.cars') },
        ]}
      />
      {view === 'plates' ? <PlatesGarage userId={userId} /> : userId ? <UserCars userId={userId} /> : <CarsGarage />}
    </div>
  );
}

function UserCars({ userId }: { userId: string }) {
  const { t } = useT();
  const nav = useNav();
  const cars = useQuery({ queryKey: ['userCars', userId], queryFn: () => api.userCars(userId) });
  if (!cars.data) return <PlateTileSkeleton />;
  if (cars.data.length === 0) return <EmptyState text={t('cm.empty')} />;
  return (
    <div className="bays">
      {cars.data.map((c) => (
        <CarTile key={c.id} car={c} onClick={() => nav.push({ name: 'car', id: c.id })} />
      ))}
    </div>
  );
}

function PlatesGarage({ userId }: { userId?: string }) {
  const { t, locale } = useT();
  const nav = useNav();
  const [filters, setFilters] = useState<GarageFilters>({ sort: 'newest' });
  const summary = useQuery({ queryKey: ['garage', 'summary'], queryFn: api.garageSummary, enabled: !userId });

  const list = useInfiniteQuery({
    queryKey: ['garage', userId ?? 'me', filters],
    queryFn: ({ pageParam }) => api.garage(filters, pageParam, userId),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const setTier = (tier?: Tier) => setFilters((f) => ({ ...f, tier }));

  return (
    <div className="stack">
      {summary.data && (
        <div className="muted small">{t('garage.summary', { n: summary.data.total, v: formatNumber(summary.data.value) })}</div>
      )}

      <div className="chips-row">
        <button className={`chip${!filters.tier ? ' active' : ''}`} onClick={() => setTier(undefined)}>
          {t('garage.all')}
        </button>
        {TIERS.map((tier) => (
          <button
            key={tier}
            className={`chip${filters.tier === tier ? ' active' : ''}`}
            style={{ ['--c' as string]: TIER_COLORS[tier] }}
            onClick={() => setTier(tier)}
          >
            {TIER_NAMES[locale][tier]}
            {summary.data ? ` · ${summary.data.byTier[tier]}` : ''}
          </button>
        ))}
      </div>

      <div className="row">
        {!userId && (
          <select
            value={filters.region ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value || undefined }))}
          >
            <option value="">{t('garage.anyRegion')}</option>
            {summary.data?.regions.map((r) => (
              <option key={r} value={r}>
                {r} — {getRegion(r)?.name[locale] ?? ''}
              </option>
            ))}
          </select>
        )}
        <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as GarageSort }))}>
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {list.isPending ? (
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <PlateTileSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState text={t('garage.empty')} />
      ) : (
        <div className="grid">
          {items.map((p) => (
            <PlateTile key={p.id} plate={p} price={p.listing?.price} onClick={() => nav.push({ name: 'plate', id: p.id })} />
          ))}
        </div>
      )}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </div>
  );
}
