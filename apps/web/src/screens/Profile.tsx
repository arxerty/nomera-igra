import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TIERS, TIER_COLORS, TIER_NAMES, type MeDto, type SettingsDto } from '@nomer/shared';
import { api } from '../api';
import { Plate } from '../components/Plate';
import { Avatar, Segmented, Skeleton, Toggle, useToast } from '../components/ui';
import { formatDate, formatNumber } from '../format';
import { useApiError, useMe } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { openTelegramLink } from '../telegram';

export function ProfileScreen() {
  const { t, locale } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = useApiError();
  const { data: me } = useMe();
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });

  async function updateSetting(patch: Partial<SettingsDto>) {
    // Оптимистично: настройки применяются сразу, сервер — источник истины.
    qc.setQueryData<MeDto>(['me'], (m) => (m ? { ...m, settings: { ...m.settings, ...patch } } : m));
    try {
      const settings = await api.updateSettings(patch);
      qc.setQueryData<MeDto>(['me'], (m) => (m ? { ...m, settings } : m));
    } catch (e) {
      onError(e);
      void qc.invalidateQueries({ queryKey: ['me'] });
    }
  }

  const p = profile.data;
  if (!p || !me) {
    return (
      <div className="screen stack">
        <Skeleton h={64} r={16} />
        <Skeleton h={120} r={16} />
        <Skeleton h={200} r={16} />
      </div>
    );
  }

  const maxTier = Math.max(1, ...TIERS.map((x) => p.stats.byTier[x]));
  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(p.referralLink);
      toast(t('profile.copied'));
    } catch {
      toast(p.referralLink);
    }
  };
  const shareRef = () =>
    openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(p.referralLink)}&text=${encodeURIComponent(t('profile.shareText'))}`,
    );

  return (
    <div className="screen stack">
      <div className="row">
        <Avatar user={p.user} size={56} />
        <div>
          <div className="screen-title" style={{ margin: 0, fontSize: 22 }}>{p.user.name}</div>
          <div className="muted small">{t('profile.since', { date: formatDate(p.memberSince, locale) })}</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {[
          [t('profile.rolls'), formatNumber(p.stats.totalRolls)],
          [t('profile.plates'), formatNumber(p.stats.platesOwned)],
          [t('profile.value'), formatNumber(p.stats.collectionValue)],
          [t('profile.rank'), p.ranks.value ? `#${p.ranks.value}` : '—'],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <div className="muted small">{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <b>{t('profile.byTier')}</b>
        {TIERS.map((x) => (
          <div key={x} className="row">
            <span className="small" style={{ width: 96, color: TIER_COLORS[x] }}>{TIER_NAMES[locale][x]}</span>
            <div className="progress grow">
              <div style={{ width: `${(p.stats.byTier[x] / maxTier) * 100}%`, background: TIER_COLORS[x] }} />
            </div>
            <span className="small" style={{ width: 28, textAlign: 'right' }}>{p.stats.byTier[x]}</span>
          </div>
        ))}
      </div>

      {p.stats.bestPlate && (
        <button className="card stack" style={{ gap: 8, textAlign: 'left' }} onClick={() => nav.push({ name: 'plate', id: p.stats.bestPlate!.id })}>
          <b>{t('profile.best')}</b>
          <Plate plate={p.stats.bestPlate} tier={p.stats.bestPlate.tier} />
        </button>
      )}

      <div className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <b>🤝 {t('profile.ref')}</b>
          <span className="muted small">
            {t('profile.referrals')}: {p.stats.referrals}
          </span>
        </div>
        <div className="muted small">{t('profile.refText')}</div>
        <div className="row">
          <button className="btn btn-primary grow" onClick={shareRef}>{t('home.share')}</button>
          <button className="btn grow" onClick={copyRef}>{t('profile.copy')}</button>
        </div>
      </div>

      <div className="row">
        <button className="btn grow" onClick={() => nav.push({ name: 'trades' })}>🔁 {t('profile.trades')}</button>
        <button className="btn grow" onClick={() => nav.push({ name: 'odds' })}>🎲 {t('odds.title')}</button>
      </div>
      <div className="row">
        <button className="btn grow" onClick={() => nav.push({ name: 'achievements' })}>🎖️ {t('ach.title')}</button>
        <button className="btn grow" onClick={() => nav.push({ name: 'clubs' })}>🤝 {t('club.title')}</button>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <b>{t('profile.settings')}</b>
        <div className="row between">
          <span>{t('profile.language')}</span>
          <div style={{ width: 140 }}>
            <Segmented
              value={me.settings.locale}
              onChange={(locale) => updateSetting({ locale })}
              options={[
                { value: 'ru', label: 'RU' },
                { value: 'en', label: 'EN' },
              ]}
            />
          </div>
        </div>
        <div className="row between">
          <span>{t('profile.sound')}</span>
          <Toggle on={me.settings.soundEnabled} onChange={(soundEnabled) => updateSetting({ soundEnabled })} />
        </div>
        <div className="row between">
          <span>{t('profile.haptics')}</span>
          <Toggle on={me.settings.hapticsEnabled} onChange={(hapticsEnabled) => updateSetting({ hapticsEnabled })} />
        </div>
        <div className="row between">
          <span>{t('profile.notifications')}</span>
          <Toggle
            on={me.settings.notificationsEnabled}
            onChange={(notificationsEnabled) => updateSetting({ notificationsEnabled })}
          />
        </div>
      </div>
    </div>
  );
}
