import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  CAR_CLASS_NAMES,
  CAR_STAT_NAMES,
  COMBO_NAMES,
  carModelTitle,
  type CarClass,
  type CarDto,
  type CarModelDto,
  type CarStats,
  type ComboId,
} from '@nomer/shared';
import { api } from '../api';
import { useT, type TKey } from '../i18n';
import { formatNumber } from '../format';
import { CarView } from './CarView';
import { Plate } from './Plate';
import { Coin } from './ui';

/** Публичные настройки машинных режимов; меняются редко. */
export function useCarsConfig() {
  return useQuery({ queryKey: ['carsConfig'], queryFn: api.carsConfig, staleTime: 5 * 60_000 });
}

/** Цвета эксклюзивных окрасок по id — для отрисовки машин. */
export function useExclusiveColors(): Record<string, string[]> {
  const { data } = useCarsConfig();
  return useMemo(
    () => Object.fromEntries((data?.cars.tuning.exclusivePaints ?? []).map((p) => [p.id, p.colors])),
    [data],
  );
}

export const CLASS_COLORS: Record<CarClass, string> = {
  economy: 'var(--tier-common)',
  comfort: 'var(--tier-uncommon)',
  business: 'var(--tier-rare)',
  premium: 'var(--tier-epic)',
  luxury: 'var(--tier-legendary)',
  collectible: 'var(--tier-mythic)',
};

export function ClassBadge({ carClass }: { carClass: CarClass }) {
  const { locale } = useT();
  return (
    <span className="tier-badge" style={{ ['--c' as string]: CLASS_COLORS[carClass] }}>
      {CAR_CLASS_NAMES[locale][carClass]}
    </span>
  );
}

export function ComboChips({ combos }: { combos: ComboId[] }) {
  const { locale } = useT();
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      {combos.map((c) => (
        <span key={c} className={`combo-chip combo-${c}`} title={COMBO_NAMES[locale][c].hint}>
          {COMBO_NAMES[locale][c].title}
        </span>
      ))}
    </div>
  );
}

const STAT_KEYS = ['speed', 'acceleration', 'handling', 'prestige'] as const;

/** Полосы характеристик; `base` — значения до тюнинга, разница подсвечивается. */
export function StatBars({ stats, base }: { stats: CarStats; base?: CarStats }) {
  const { locale } = useT();
  return (
    <div className="stack" style={{ gap: 6 }}>
      {STAT_KEYS.map((k) => {
        const gain = base ? stats[k] - base[k] : 0;
        return (
          <div key={k} className="row">
            <span className="small muted" style={{ width: 104 }}>{CAR_STAT_NAMES[locale][k]}</span>
            <div className="progress grow">
              <div style={{ width: `${Math.min(100, stats[k])}%` }} />
            </div>
            <span className="small" style={{ width: 44, textAlign: 'right', fontWeight: 700 }}>
              {stats[k]}
              {gain > 0 && <span style={{ color: 'var(--success)' }}> +{gain}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Плитка машины: сама машина, номер, класс и стоимость. */
export function CarTile({ car, onClick, price }: { car: CarDto; onClick?: () => void; price?: number }) {
  const { t } = useT();
  const exclusive = useExclusiveColors();
  return (
    <button className="tile car-tile" style={{ ['--c' as string]: CLASS_COLORS[car.model.class] }} onClick={onClick}>
      <div className="row between">
        <span className="car-name">{carModelTitle(car.model)}</span>
        {car.busy && <span className={`busy-dot busy-${car.busy}`}>{t(`busy.${car.busy}` as TKey)}</span>}
      </div>
      <CarView archetype={car.model.archetype} tuning={car.tuning} exclusiveColors={exclusive} />
      {car.plate ? (
        <div className="car-tile-plate">
          <Plate plate={car.plate} tier={car.plate.tier} glow={false} />
        </div>
      ) : (
        <div className="car-tile-plate empty muted small">{t('car.noPlate')}</div>
      )}
      <div className="row between">
        <ClassBadge carClass={car.model.class} />
        {price !== undefined ? <Coin value={price} /> : <span className="muted small">{formatNumber(car.value)}</span>}
      </div>
      {car.combos.length > 0 && <ComboChips combos={car.combos} />}
    </button>
  );
}

/** Модель из салона без тюнинга — для витрины и «призраков». */
export function ModelPreview({ model, color }: { model: CarModelDto; color: string }) {
  return (
    <CarView
      archetype={model.archetype}
      tuning={{ paint: { finish: 'gloss', color }, wheels: 0, tint: 0, bodykit: 0, underglow: null, engine: 0, suspension: 0 }}
    />
  );
}
