import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import {
  BONUS_NAMES,
  TIER_COLORS,
  TIER_NAMES,
  TRAIT_NAMES,
  formatPlate,
  isSpecialTier,
  type RollResultDto,
} from '@nomer/shared';
import { api } from '../api';
import { celebrate } from '../celebrate';
import { MaskPlate } from '../components/Plate';
import { SlotPlate } from '../components/SlotPlate';
import { Avatar, Coin, Skeleton, TierBadge, useToast } from '../components/ui';
import { formatDuration, formatNumber, useCountdown } from '../format';
import { useApiError, useMe, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { sound } from '../sound';
import { confirmDialog, haptic, shareInline } from '../telegram';
import { BuyRollsSheet } from './BuyRolls';

type Phase = 'idle' | 'spinning' | 'revealed';

export function HomeScreen() {
  const { t, locale } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = useApiError();
  const patchBalance = usePatchBalance();
  const { data: me } = useMe();
  const odds = useQuery({ queryKey: ['odds'], queryFn: api.odds, staleTime: 60_000 });

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<RollResultDto | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [sold, setSold] = useState(false);

  const serverOffset = me ? Date.parse(me.serverTime) - Date.now() : 0;
  const freeLeft = useCountdown(me?.freeRollAt ?? null, serverOffset);
  if (!me) return <HomeSkeleton />;

  const freeReady = me.freeRollAt === null || freeLeft === 0;
  const canRoll = freeReady || me.rolls > 0;

  async function roll() {
    if (phase === 'spinning') return;
    if (!canRoll) {
      setBuyOpen(true);
      return;
    }
    haptic.impact('medium');
    setPhase('spinning');
    setResult(null);
    setSold(false);
    try {
      const res = await api.roll();
      setResult(res);
      patchBalance({ chips: res.chips, rolls: res.rolls, freeRollAt: res.freeRollAt });
    } catch (e) {
      setPhase('idle');
      onError(e);
    }
  }

  function onRevealed() {
    if (!result) return;
    setPhase('revealed');
    celebrate(result.plate.tier);
    if (result.rolledTier !== result.plate.tier) {
      toast(t('home.downgraded', { tier: TIER_NAMES[locale][result.rolledTier] }));
    }
    void qc.invalidateQueries({ queryKey: ['garage'] });
    void qc.invalidateQueries({ queryKey: ['quests'] });
  }

  async function sell() {
    if (!result) return;
    const plate = result.plate;
    const ok = await confirmDialog(t('plate.sellConfirm', { plate: formatPlate(plate), n: formatNumber(plate.value) }));
    if (!ok) return;
    try {
      const res = await api.sellPlate(plate.id);
      patchBalance({ chips: res.chips });
      sound.coin();
      haptic.notify('success');
      toast(t('plate.sold', { n: formatNumber(res.received) }));
      setSold(true);
      void qc.invalidateQueries({ queryKey: ['garage'] });
    } catch (e) {
      onError(e);
    }
  }

  function share() {
    if (!result) return;
    if (!shareInline(`plate ${result.plate.key}`)) toast(formatPlate(result.plate));
  }

  const shown = result?.plate ?? me.lastPlate;
  const revealed = phase === 'revealed' && result ? result : null;
  const tier = revealed ? revealed.plate.tier : phase === 'idle' ? me.lastPlate?.tier : null;
  const legendaryPct = odds.data?.tiers.filter((x) => x.tier === 'legendary' || x.tier === 'mythic').reduce((s, x) => s + x.percent, 0);

  return (
    <div className="screen stack">
      <div className="brand">
        <div className="brand-name">
          <span className="brand-logo" />
          {t('appName')}
        </div>
        <button onClick={() => nav.push({ name: 'profile' })} aria-label={t('profile.title')}>
          <Avatar user={me.user} size={34} />
        </button>
      </div>

      <div className="row">
        <button className="balance grow" onClick={() => setBuyOpen(true)}>
          <Coin value={me.chips} />
        </button>
        <button className="balance grow" onClick={() => setBuyOpen(true)}>
          🎰 {me.rolls}
        </button>
        <button className="balance grow" onClick={() => nav.push({ name: 'odds' })}>
          🎲 {t('home.odds')}
        </button>
      </div>

      {me.daily.canClaim && (
        <motion.button
          className="note warn"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => nav.switchTab('quests')}
          style={{ justifyContent: 'space-between', textAlign: 'left' }}
        >
          <span>🎁 {t('home.dailyReady')}</span>
          <span className="muted">›</span>
        </motion.button>
      )}

      <div className="stage" style={{ ['--stage-color' as string]: tier ? TIER_COLORS[tier] : undefined }}>
        <div className="panel-title">
          <span>
            <span className="icon">✦</span>
            {t('home.panel')}
          </span>
          {tier && phase !== 'spinning' && <TierBadge tier={tier} />}
        </div>

        <SlotPlate
          result={result?.plate ?? null}
          spinning={phase === 'spinning'}
          fallback={shown}
          tier={tier}
          glow={Boolean(revealed && isSpecialTier(revealed.plate.tier))}
          onReelStop={(i, total) => {
            sound.tick(i);
            haptic.impact(i === total - 1 ? 'heavy' : 'light');
          }}
          onDone={onRevealed}
        />

        <div className="small muted center" style={{ minHeight: 36, marginTop: 10 }}>
          <AnimatePresence mode="wait">
            {revealed ? (
              <motion.div key={revealed.plate.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                {[
                  ...revealed.plate.traits.map((x) => TRAIT_NAMES[locale][x]),
                  ...revealed.plate.bonuses.map((b) => `★ ${BONUS_NAMES[locale][b]}`),
                ].join(' · ') || TIER_NAMES[locale].common}
                {' · '}
                <b style={{ color: 'var(--text)' }}>{formatNumber(revealed.plate.value)}</b>
              </motion.div>
            ) : (
              <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {phase === 'spinning' ? t('home.rolling') : shown ? t('home.last') : t('home.empty')}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="divider" style={{ margin: '10px 0 12px' }} />

        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="subpanel grow">
            <div className="subpanel-label">{t('home.freeLabel')}</div>
            <div className="btn btn-soft btn-sm btn-block" style={{ pointerEvents: 'none' }}>
              ⏱ {freeReady ? t('home.ready') : freeLeft !== null ? formatDuration(freeLeft) : '—'}
            </div>
          </div>
          <div className="subpanel grow">
            <div className="subpanel-label">{t('home.rollsLabel', { n: me.rolls })}</div>
            <button className="btn btn-soft btn-sm btn-block" onClick={() => setBuyOpen(true)}>
              <span className="coin" /> {formatNumber(me.economy.rollCostChips)}
            </button>
          </div>
        </div>

        {revealed && !sold && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-soft btn-sm grow" onClick={sell}>
              {t('home.sellFor', { n: formatNumber(revealed.plate.value) })}
            </button>
            <button className="btn btn-soft btn-sm grow" onClick={share}>
              {t('home.share')}
            </button>
          </div>
        )}
      </div>

      <div className="row">
        <button className="btn btn-primary btn-lg grow" onClick={roll} disabled={phase === 'spinning'}>
          ✓ {canRoll ? t('home.roll') : t('home.noRolls')}
        </button>
        <button
          className="btn btn-success btn-lg grow"
          disabled={!revealed || sold}
          onClick={() => revealed && nav.push({ name: 'plate', id: revealed.plate.id })}
        >
          ▣ {t('home.toGarage')}
        </button>
      </div>

      {odds.data && odds.data.vipSeries.length > 0 && (
        <div className="card">
          <div className="panel-title">
            <span>
              <span className="icon" style={{ color: 'var(--danger)' }}>⛨</span>
              {t('home.special')}
            </span>
          </div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {t('home.specialText', { p: legendaryPct !== undefined ? legendaryPct.toFixed(2) : '—' })}
          </div>
          <div className="chips-row" style={{ gap: 10 }}>
            {odds.data.vipSeries.map((v) => (
              <div key={v.letters} className="mini-plate">
                <MaskPlate body={`${v.letters[0]}***${v.letters.slice(1)}`} region={v.regions?.[0] ?? '**'} />
              </div>
            ))}
          </div>
        </div>
      )}

      <BuyRollsSheet open={buyOpen} onClose={() => setBuyOpen(false)} />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="screen stack">
      <div className="row between">
        <Skeleton h={22} w={170} />
        <Skeleton h={34} w={34} r={17} />
      </div>
      <Skeleton h={34} />
      <Skeleton h={300} r={12} />
      <Skeleton h={52} r={8} />
    </div>
  );
}
