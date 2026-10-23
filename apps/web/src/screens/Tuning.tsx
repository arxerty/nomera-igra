import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  PAINT_FINISHES,
  PAINT_FINISH_NAMES,
  carModelTitle,
  effectiveStats,
  tuningCost,
  upgradeLevelCost,
  type CarDto,
  type CarTuning,
  type PaintFinish,
} from '@nomer/shared';
import { api } from '../api';
import { CarView } from '../components/CarView';
import { StatBars, useCarsConfig, useExclusiveColors } from '../components/cars';
import { Skeleton, useToast } from '../components/ui';
import { formatNumber } from '../format';
import { useAction, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { useMainButton, useNav } from '../nav';
import { sound } from '../sound';
import { haptic, openInvoice } from '../telegram';

export function TuningScreen({ carId }: { carId: string }) {
  const { data: config } = useCarsConfig();
  const card = useQuery({ queryKey: ['car', carId], queryFn: () => api.car(carId) });
  const garage = useQuery({ queryKey: ['cars'], queryFn: api.cars });
  if (!config || !card.data || !garage.data) {
    return (
      <div className="screen stack">
        <Skeleton h={200} r={12} />
        <Skeleton h={300} r={12} />
      </div>
    );
  }
  return <TuningEditor car={card.data.car} unlocked={garage.data.unlockedPaints} />;
}

function TuningEditor({ car, unlocked }: { car: CarDto; unlocked: string[] }) {
  const { t, locale } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const exclusive = useExclusiveColors();
  const { data: config } = useCarsConfig();
  const [draft, setDraft] = useState<CarTuning>(car.tuning);
  const [busy, run] = useAction();
  useEffect(() => setDraft(car.tuning), [car.tuning]);

  const cfg = config!.cars.tuning;
  const cost = tuningCost(car.model.class, car.tuning, draft, cfg);
  const preview = effectiveStats(car.model, draft, cfg);
  const changed = JSON.stringify(draft) !== JSON.stringify(car.tuning);
  const set = (patch: Partial<CarTuning>) => {
    haptic.select();
    setDraft((d) => ({ ...d, ...patch }));
  };

  const onlyPaint = changed && JSON.stringify({ ...draft, paint: car.tuning.paint }) === JSON.stringify(car.tuning);
  const paintStars = cfg.paintStars[draft.paint.finish];

  const apply = () =>
    run(async () => {
      if (!cost.ok) return;
      await api.tuneCar(car.id, draft);
      if (cost.chips > 0) {
        const me = await api.me();
        patchBalance({ chips: me.chips });
      }
      sound.coin();
      haptic.notify('success');
      toast(t('tuning.applied'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['car', car.id] }), qc.invalidateQueries({ queryKey: ['cars'] })]);
      nav.back();
    });

  const buyPaintStars = () =>
    run(async () => {
      const { link } = await api.itemInvoice({ kind: 'paint', carId: car.id, finish: draft.paint.finish, color: draft.paint.color });
      if ((await openInvoice(link)) === 'paid') {
        toast(t('tuning.applied'));
        setTimeout(() => void qc.invalidateQueries({ queryKey: ['car', car.id] }), 1500);
      }
    });

  const label = !cost.ok
    ? t('tuning.noDowngrade')
    : cost.chips > 0
      ? t('tuning.apply', { n: formatNumber(cost.chips) })
      : t('tuning.applyFree');
  const nativeMain = useMainButton(changed ? { text: label, onClick: apply, disabled: !cost.ok, progress: busy } : null);

  const finishes = PAINT_FINISHES.filter((f) => f !== 'exclusive' || cfg.exclusivePaints.length > 0);
  const pickFinish = (finish: PaintFinish) => {
    if (finish === 'exclusive') {
      const first = cfg.exclusivePaints.find((p) => unlocked.includes(p.id)) ?? cfg.exclusivePaints[0]!;
      set({ paint: { finish, color: first.id } });
    } else {
      const color = cfg.palette.includes(draft.paint.color) ? draft.paint.color : cfg.palette[0]!;
      set({ paint: { finish, color } });
    }
  };
  const levelChips = (count: number, value: number, onPick: (v: number) => void, min = 0, priceOf?: (lvl: number) => number) => (
    <div className="option-grid">
      {Array.from({ length: count + 1 }, (_, v) => (
        <button
          key={v}
          className={`chip${value === v ? ' active' : ''}${v < min ? ' locked' : ''}`}
          disabled={v < min}
          onClick={() => onPick(v)}
        >
          {v === 0 ? t('tuning.stock') : priceOf ? `${t('tuning.level', { n: v })}` : v}
          {priceOf && v > min && v > 0 ? ` · ${formatNumber(priceOf(v))}` : ''}
        </button>
      ))}
    </div>
  );

  return (
    <div className="screen stack">
      <div className="stage">
        <div className="screen-title" style={{ margin: 0 }}>
          {t('tuning.title')} · {carModelTitle(car.model)}
        </div>
        <CarView archetype={car.model.archetype} tuning={draft} exclusiveColors={exclusive} />
      </div>

      <div className="card">
        <StatBars stats={preview} base={car.stats} />
      </div>

      <Section title={`🎨 ${t('tuning.paint')}`}>
        <div className="option-grid">
          {finishes.map((finish) => (
            <button
              key={finish}
              className={`chip${draft.paint.finish === finish ? ' active' : ''}`}
              onClick={() => pickFinish(finish)}
            >
              {PAINT_FINISH_NAMES[locale][finish]}
            </button>
          ))}
        </div>
        {draft.paint.finish === 'exclusive' ? (
          <div className="option-grid">
            {cfg.exclusivePaints.map((p) => (
              <button
                key={p.id}
                className={`chip${draft.paint.color === p.id ? ' active' : ''}${unlocked.includes(p.id) ? '' : ' locked'}`}
                disabled={!unlocked.includes(p.id)}
                onClick={() => set({ paint: { finish: 'exclusive', color: p.id } })}
              >
                {p.title[locale]}
                {unlocked.includes(p.id) ? '' : ` · ${t('tuning.locked')}`}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="swatches">
              {cfg.palette.map((c) => (
                <button
                  key={c}
                  className={`swatch${draft.paint.color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => set({ paint: { finish: draft.paint.finish, color: c } })}
                  aria-label={c}
                />
              ))}
            </div>
            {cfg.paintChips[draft.paint.finish] > 0 && (
              <span className="muted small">
                {PAINT_FINISH_NAMES[locale][draft.paint.finish]}: {formatNumber(cfg.paintChips[draft.paint.finish])}
                {paintStars > 0 ? ` ${t('common.or')} ${t('common.stars', { n: paintStars })}` : ''}
              </span>
            )}
          </>
        )}
      </Section>

      <Section title={`🛞 ${t('tuning.wheels')} · ${formatNumber(cfg.wheels.costChips)}`}>
        {levelChips(cfg.wheels.variants, draft.wheels, (wheels) => set({ wheels }))}
      </Section>
      <Section title={`🕶️ ${t('tuning.tint')} · ${formatNumber(cfg.tint.costPerLevel)}`}>
        {levelChips(cfg.tint.maxLevel, draft.tint, (tint) => set({ tint }))}
      </Section>
      <Section title={`🏎️ ${t('tuning.bodykit')} · ${formatNumber(cfg.bodykit.costChips)}`}>
        {levelChips(cfg.bodykit.variants, draft.bodykit, (bodykit) => set({ bodykit }))}
      </Section>
      <Section title={`💡 ${t('tuning.underglow')} · ${formatNumber(cfg.underglow.costChips)}`}>
        <div className="swatches">
          <button className={`swatch${draft.underglow === null ? ' active' : ''}`} onClick={() => set({ underglow: null })}>
            ✕
          </button>
          {cfg.underglow.colors.map((c) => (
            <button
              key={c}
              className={`swatch${draft.underglow === c ? ' active' : ''}`}
              style={{ background: c, boxShadow: `0 0 10px ${c}` }}
              onClick={() => set({ underglow: c })}
              aria-label={c}
            />
          ))}
        </div>
      </Section>
      <Section title={`⚙️ ${t('tuning.engine')}`}>
        {levelChips(cfg.engine.maxLevel, draft.engine, (engine) => set({ engine }), car.tuning.engine, (lvl) =>
          upgradeLevelCost('engine', lvl, car.model.class, cfg),
        )}
      </Section>
      <Section title={`🔩 ${t('tuning.suspension')}`}>
        {levelChips(cfg.suspension.maxLevel, draft.suspension, (suspension) => set({ suspension }), car.tuning.suspension, (lvl) =>
          upgradeLevelCost('suspension', lvl, car.model.class, cfg),
        )}
      </Section>

      {changed && (
        <div className="stack" style={{ gap: 8 }}>
          {!nativeMain && (
            <button className="btn btn-primary btn-block btn-lg" disabled={!cost.ok || busy} onClick={apply}>
              {label}
            </button>
          )}
          {onlyPaint && paintStars > 0 && (
            <button className="btn btn-block" disabled={busy} onClick={buyPaintStars}>
              {t('tuning.starsPaint', { n: paintStars })}
            </button>
          )}
          <button className="btn btn-block" onClick={() => setDraft(car.tuning)}>
            {t('tuning.reset')}
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="panel-title" style={{ margin: 0, paddingBottom: 8 }}>
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}
