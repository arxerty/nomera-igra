import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CAR_CLASSES, CAR_CLASS_NAMES, TIERS, TIER_COLORS, TIER_NAMES, parseMask, type CarClass, type Tier } from '@nomer/shared';
import { api, type CarMarketFilters, type CarMarketSort, type MarketFilters, type MarketSort } from '../api';
import { CLASS_COLORS, CarTile } from '../components/cars';
import { MaskPlate } from '../components/Plate';
import { EmptyState, LoadMore, PlateTile, PlateTileSkeleton, Segmented } from '../components/ui';
import { useMe } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';

const SORTS: MarketSort[] = ['newest', 'price_asc', 'price_desc', 'value_desc'];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function MarketScreen() {
  const { t } = useT();
  const [view, setView] = useState<'plates' | 'cars'>('plates');
  return (
    <div className="screen stack">
      <div className="screen-title">{t('market.title')}</div>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'plates', label: t('garage.plates') },
          { value: 'cars', label: t('garage.cars') },
        ]}
      />
      {view === 'plates' ? <PlatesMarket /> : <CarsMarket />}
    </div>
  );
}

function CarsMarket() {
  const { t, locale } = useT();
  const nav = useNav();
  const [carClass, setCarClass] = useState<CarClass | undefined>();
  const [withPlate, setWithPlate] = useState<boolean | undefined>();
  const [sort, setSort] = useState<CarMarketSort>('newest');
  const filters: CarMarketFilters = { carClass, withPlate, sort };
  const list = useInfiniteQuery({
    queryKey: ['carMarket', filters],
    queryFn: ({ pageParam }) => api.carMarket(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="stack">
      <div className="chips-row">
        {([undefined, true, false] as const).map((v) => (
          <button key={String(v)} className={`chip${withPlate === v ? ' active' : ''}`} onClick={() => setWithPlate(v)}>
            {v === undefined ? t('garage.all') : v ? t('cm.withPlate') : t('cm.withoutPlate')}
          </button>
        ))}
        {CAR_CLASSES.map((c) => (
          <button
            key={c}
            className={`chip${carClass === c ? ' active' : ''}`}
            style={{ ['--c' as string]: CLASS_COLORS[c] }}
            onClick={() => setCarClass((cur) => (cur === c ? undefined : c))}
          >
            {CAR_CLASS_NAMES[locale][c]}
          </button>
        ))}
      </div>
      <select value={sort} onChange={(e) => setSort(e.target.value as CarMarketSort)}>
        {(['newest', 'price_asc', 'price_desc'] as const).map((s) => (
          <option key={s} value={s}>
            {t(`sort.${s}`)}
          </option>
        ))}
      </select>
      {list.isPending ? (
        <div className="bays">
          {Array.from({ length: 4 }, (_, i) => (
            <PlateTileSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState text={t('cm.empty')} />
      ) : (
        <div className="bays">
          {items.map((l) => (
            <CarTile key={l.id} car={l.car} price={l.price} onClick={() => nav.push({ name: 'car', id: l.car.id })} />
          ))}
        </div>
      )}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </div>
  );
}

function PlatesMarket() {
  const { t, locale } = useT();
  const nav = useNav();
  const { data: me } = useMe();
  const [mask, setMask] = useState('');
  const [region, setRegion] = useState('');
  const [tier, setTier] = useState<Tier | undefined>();
  const [sort, setSort] = useState<MarketSort>('newest');
  const [mine, setMine] = useState(false);

  const debouncedMask = useDebounced(mask.trim(), 350);
  const debouncedRegion = useDebounced(region.trim(), 350);
  const maskValid = debouncedMask === '' || parseMask(debouncedMask) !== null;
  const regionValid = debouncedRegion === '' || /^\d{2,3}$/.test(debouncedRegion);

  const filters: MarketFilters = {
    mask: maskValid ? debouncedMask || undefined : undefined,
    region: regionValid ? debouncedRegion || undefined : undefined,
    tier,
    sort,
    sellerId: mine ? me?.user.id : undefined,
  };

  // Превью маски табличкой со звёздочками на месте подстановок.
  const parsedMask = mask.trim() ? parseMask(mask.trim()) : null;
  const preview =
    parsedMask || /^\d{2,3}$/.test(region)
      ? {
          body: parsedMask ? parsedMask.body.map((c) => c ?? '*').join('') : '******',
          region: parsedMask?.region ? parsedMask.region.map((c) => c ?? '*').join('') : region || '**',
        }
      : null;

  const list = useInfiniteQuery({
    queryKey: ['market', filters],
    queryFn: ({ pageParam }) => api.market(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <input
            className="grow"
            placeholder={t('market.mask')}
            value={mask}
            maxLength={12}
            onChange={(e) => setMask(e.target.value.toUpperCase())}
            style={{ borderColor: maskValid ? undefined : 'var(--danger)', fontFamily: 'monospace', letterSpacing: '0.1em' }}
          />
          <input
            style={{ width: 92 }}
            placeholder={t('market.region')}
            inputMode="numeric"
            value={region}
            maxLength={3}
            onChange={(e) => setRegion(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="muted small">{t('market.maskHelp')}</div>
        {preview && (
          <div style={{ maxWidth: 300, alignSelf: 'center', width: '100%' }}>
            <MaskPlate body={preview.body} region={preview.region} />
          </div>
        )}
      </div>

      <div className="chips-row">
        <button className={`chip${mine ? ' active' : ''}`} onClick={() => setMine((v) => !v)}>
          {t('market.mine')}
        </button>
        {TIERS.map((x) => (
          <button
            key={x}
            className={`chip${tier === x ? ' active' : ''}`}
            style={{ ['--c' as string]: TIER_COLORS[x] }}
            onClick={() => setTier((cur) => (cur === x ? undefined : x))}
          >
            {TIER_NAMES[locale][x]}
          </button>
        ))}
      </div>

      <select value={sort} onChange={(e) => setSort(e.target.value as MarketSort)}>
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`sort.${s}`)}
          </option>
        ))}
      </select>

      {list.isPending ? (
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <PlateTileSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState text={t('market.empty')} />
      ) : (
        <div className="grid">
          {items.map((l) => (
            <PlateTile key={l.id} plate={l.plate} price={l.price} onClick={() => nav.push({ name: 'plate', id: l.plate.id })} />
          ))}
        </div>
      )}
      <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
    </div>
  );
}
