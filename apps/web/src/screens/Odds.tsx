import { useQuery } from '@tanstack/react-query';
import { BONUS_NAMES, TIER_COLORS, formatDigits, type Tier } from '@nomer/shared';
import { api } from '../api';
import { MaskPlate } from '../components/Plate';
import { Skeleton, TierBadge } from '../components/ui';
import { formatNumber } from '../format';
import { useT, type TKey } from '../i18n';

function formatPercent(p: number): string {
  if (p === 0) return '0%';
  if (p < 0.01) return '<0.01%';
  return `${p < 1 ? p.toFixed(2) : p.toFixed(1)}%`;
}

/** Экран «Шансы»: шансы берутся из активного конфига на сервере. */
export function OddsScreen() {
  const { t, locale } = useT();
  const odds = useQuery({ queryKey: ['odds'], queryFn: api.odds, staleTime: 60_000 });

  if (!odds.data) {
    return (
      <div className="screen stack">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h={74} r={16} />
        ))}
      </div>
    );
  }
  const d = odds.data;
  const mythicNumbers = d.mythicNumbers.map(formatDigits).join(' / ');

  return (
    <div className="screen stack">
      <div className="screen-title">{t('odds.title')}</div>
      <div className="muted small">{t('odds.intro')}</div>

      {[...d.tiers].reverse().map(({ tier, percent, price }) => (
        <div key={tier} className="card stack" style={{ gap: 6, borderLeft: `3px solid ${TIER_COLORS[tier as Tier]}` }}>
          <div className="row between">
            <TierBadge tier={tier} />
            <b style={{ color: TIER_COLORS[tier], fontSize: 18 }}>{formatPercent(percent)}</b>
          </div>
          <div className="small">{t(`odds.rule.${tier}` as TKey, { numbers: mythicNumbers })}</div>
          <div className="muted small">{t('odds.price', { n: formatNumber(price) })}</div>
        </div>
      ))}

      <div className="card stack" style={{ gap: 6 }}>
        <b>{t('odds.bonuses')}</b>
        {Object.entries(d.bonusMultipliers).map(([id, m]) => (
          <div key={id} className="row between small">
            <span>★ {BONUS_NAMES[locale][id as keyof typeof BONUS_NAMES.ru]}</span>
            <b>×{m}</b>
          </div>
        ))}
      </div>

      <div className="card stack" style={{ gap: 6 }}>
        <b>{t('odds.vip')}</b>
        {d.vipSeries.length === 0 ? (
          <div className="small muted">—</div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {d.vipSeries.map((v) => (
              <div key={v.letters}>
                <MaskPlate body={`${v.letters[0]}***${v.letters.slice(1)}`} region={v.regions?.[0] ?? '**'} />
                {v.regions && v.regions.length > 1 && <div className="small muted">{v.regions.join(', ')}</div>}
              </div>
            ))}
          </div>
        )}
        <b>{t('odds.capital')}</b>
        <div className="small">{d.capitalRegions.join(', ')}</div>
      </div>
    </div>
  );
}
