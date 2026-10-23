import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { carModelTitle, type CarModelDto } from '@nomer/shared';
import { api } from '../api';
import { ClassBadge, ModelPreview, StatBars, useCarsConfig } from '../components/cars';
import { Coin, Skeleton, useToast } from '../components/ui';
import { formatDuration, formatNumber, useCountdown } from '../format';
import { useAction, usePatchBalance } from '../hooks';
import { useT, type TKey } from '../i18n';
import { useNav } from '../nav';
import { sound } from '../sound';
import { confirmDialog, haptic, openInvoice } from '../telegram';

export function ShowroomScreen() {
  const { t } = useT();
  const showroom = useQuery({ queryKey: ['showroom'], queryFn: api.showroom });
  const rotatesIn = useCountdown(showroom.data?.rotatesAt ?? null);

  return (
    <div className="screen stack">
      <div>
        <div className="screen-title">🚘 {t('showroom.title')}</div>
        {showroom.data && (
          <div className="muted small">
            {t('showroom.garage', { used: showroom.data.garage.used, slots: showroom.data.garage.slots })} ·{' '}
            {t('showroom.rotates', { time: formatDuration(rotatesIn ?? 0) })}
          </div>
        )}
      </div>
      {showroom.data
        ? showroom.data.models.map((m) => <ModelCard key={m.id} model={m} full={showroom.data.garage.used >= showroom.data.garage.slots} />)
        : Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={260} r={12} />)}
    </div>
  );
}

function ModelCard({ model, full }: { model: CarModelDto; full: boolean }) {
  const { t } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const { data: config } = useCarsConfig();
  const palette = config?.cars.tuning.palette ?? ['#F4F4F2'];
  const [color, setColor] = useState(palette[0]!);
  const [busy, run] = useAction();
  const soldOut = model.editionLeft === 0;

  const afterBuy = async (carId?: string) => {
    sound.coin();
    haptic.notify('success');
    toast(t('showroom.bought'));
    await Promise.all([qc.invalidateQueries({ queryKey: ['showroom'] }), qc.invalidateQueries({ queryKey: ['cars'] })]);
    if (carId) nav.push({ name: 'car', id: carId });
  };

  const buy = () =>
    run(async () => {
      if (!(await confirmDialog(`${carModelTitle(model)} — ${formatNumber(model.priceChips)}?`))) return;
      const car = await api.buyCar(model.id, color);
      const me = await api.me();
      patchBalance({ chips: me.chips });
      await afterBuy(car.id);
    });

  const buyStars = () =>
    run(async () => {
      const { link } = await api.itemInvoice({ kind: 'car', modelId: model.id, color });
      if ((await openInvoice(link)) === 'paid') setTimeout(() => void afterBuy(), 1500);
    });

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <b>{carModelTitle(model)}</b>
        <ClassBadge carClass={model.class} />
      </div>
      <ModelPreview model={model} color={color} />
      <div className="swatches" style={{ justifyContent: 'center' }}>
        {palette.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' active' : ''}`}
            style={{ background: c, width: 26, height: 26 }}
            onClick={() => setColor(c)}
            aria-label={c}
          />
        ))}
      </div>
      <div className="row between small">
        <span className="muted">
          {t(`showroom.${model.showroom}` as TKey)} · {model.year}
        </span>
        {model.editionSize !== null && (
          <b style={{ color: soldOut ? 'var(--danger)' : 'var(--tier-mythic)' }}>
            {soldOut ? t('showroom.soldOut') : t('showroom.left', { n: model.editionLeft ?? 0, total: model.editionSize })}
          </b>
        )}
      </div>
      <StatBars stats={model.stats} />
      {model.styleNumbers.length > 0 && (
        <span className="muted small">
          {t('showroom.style', { list: model.styleNumbers.map((n) => String(n).padStart(3, '0')).join(', ') })}
        </span>
      )}
      <div className="row">
        <button className="btn btn-primary grow" disabled={busy || soldOut || full} onClick={buy}>
          {t('showroom.buy', { n: '' }).trim()} <Coin value={model.priceChips} />
        </button>
        {model.priceStars !== null && (
          <button className="btn grow" disabled={busy || soldOut || full} onClick={buyStars}>
            {t('showroom.buyStars', { n: model.priceStars })}
          </button>
        )}
      </div>
      {full && <div className="note warn">{t('garage.full')}</div>}
    </div>
  );
}
