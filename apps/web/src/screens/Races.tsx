import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CAR_MODELS, type CarArchetype, type RaceDto, type RacerDto, type RaceQueueDto } from '@nomer/shared';
import { api } from '../api';
import { CarView } from '../components/CarView';
import { useCarsConfig, useExclusiveColors } from '../components/cars';
import { Plate } from '../components/Plate';
import { EmptyState, Skeleton, useToast } from '../components/ui';
import { formatNumber } from '../format';
import { useAction, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { sound } from '../sound';
import { haptic } from '../telegram';

const ARCHETYPE_BY_MODEL = new Map(DEFAULT_CAR_MODELS.map((m) => [m.id, m.archetype]));
const archetypeOf = (r: RacerDto): CarArchetype => ARCHETYPE_BY_MODEL.get(r.modelId) ?? 'business_sedan';

/** Длительность анимации самой медленной машины. */
const ANIMATION_MS = 3600;

export function RacesScreen() {
  const { t } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const { data: config } = useCarsConfig();
  const cars = useQuery({ queryKey: ['cars'], queryFn: api.cars });
  const queue = useQuery({ queryKey: ['raceQueue'], queryFn: api.raceQueue });
  const history = useQuery({ queryKey: ['raceHistory'], queryFn: api.raceHistory });
  const [carId, setCarId] = useState<string | null>(null);
  const [bet, setBet] = useState(0);
  const [busy, run] = useAction();
  const seen = useRef<string | null | undefined>(undefined);
  const [showing, setShowing] = useState<RaceDto | null>(null);

  // Новый заезд (появился после открытия экрана) показывается анимацией.
  const last = queue.data?.lastRace ?? null;
  useEffect(() => {
    if (!queue.data) return;
    if (seen.current === undefined) {
      seen.current = last?.id ?? null;
      return;
    }
    if (last && last.id !== seen.current) {
      seen.current = last.id;
      setShowing(last);
      void qc.invalidateQueries({ queryKey: ['raceHistory'] });
      void qc.invalidateQueries({ queryKey: ['cars'] });
      void api.me().then((me) => patchBalance({ chips: me.chips }));
    }
  }, [queue.data, last, qc, patchBalance]);

  // Пока ждём соперника — опрашиваем очередь (сервер решает, когда ехать с «призраком»).
  const waiting = queue.data?.status === 'waiting';
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      void api
        .pollRace()
        .then((q) => qc.setQueryData<RaceQueueDto>(['raceQueue'], q))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [waiting, qc]);

  const myCars = cars.data?.cars ?? [];
  const idle = myCars.filter((c) => !c.busy);
  const selected = carId ?? idle[0]?.id ?? null;
  const races = config?.races;
  const bets = races ? [0, races.minBet, 100, 500, 1000, races.maxBet].filter((b, i, a) => b <= races.maxBet && a.indexOf(b) === i) : [0];

  const start = () =>
    run(async () => {
      if (!selected) return;
      const q = await api.enterRace(selected, bet);
      if (bet > 0) patchBalance({ chips: (await api.me()).chips });
      haptic.impact('medium');
      qc.setQueryData(['raceQueue'], q);
    });
  const leave = () =>
    run(async () => {
      qc.setQueryData(['raceQueue'], await api.leaveRace());
      patchBalance({ chips: (await api.me()).chips });
      toast(t('common.ok'));
    });

  if (!queue.data || !cars.data || !races) {
    return (
      <div className="screen stack">
        <Skeleton h={180} r={12} />
        <Skeleton h={120} r={12} />
      </div>
    );
  }

  return (
    <div className="screen stack">
      <div>
        <div className="screen-title">🏁 {t('race.title')}</div>
        <div className="muted small">{t('race.text')}</div>
      </div>

      {showing && <RaceTrack race={showing} onDone={() => (showing.won ? sound.coin() : undefined)} />}

      {myCars.length === 0 ? (
        <>
          <EmptyState text={t('race.noCars')} />
          <button className="btn btn-primary btn-block" onClick={() => nav.push({ name: 'showroom' })}>
            {t('garage.toShowroom')}
          </button>
        </>
      ) : waiting ? (
        <div className="card stack center" style={{ gap: 10 }}>
          <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.4 }} style={{ fontWeight: 800 }}>
            {t('race.waiting')}
          </motion.div>
          <span className="muted small">{t('race.waitingHint')}</span>
          <button className="btn btn-block" disabled={busy} onClick={leave}>
            {t('race.cancel')}
          </button>
        </div>
      ) : (
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row between">
            <b>{t('race.pickCar')}</b>
            <span className="muted small">{t('race.left', { n: queue.data.racesLeft })}</span>
          </div>
          <div className="chips-row">
            {idle.map((c) => (
              <button key={c.id} className={`chip${selected === c.id ? ' active' : ''}`} onClick={() => setCarId(c.id)}>
                {c.model.brand} {c.model.name} · {c.raceRating}
              </button>
            ))}
          </div>
          <b>{t('race.bet')}</b>
          <div className="option-grid">
            {bets.map((b) => (
              <button key={b} className={`chip${bet === b ? ' active' : ''}`} onClick={() => setBet(b)}>
                {b === 0 ? t('race.noBet') : formatNumber(b)}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block btn-lg"
            disabled={busy || !selected || queue.data.racesLeft === 0}
            onClick={start}
          >
            {showing ? t('race.again') : t('race.start')}
          </button>
          <span className="muted small">🏆 {t('race.tournament')}</span>
        </div>
      )}

      <div className="card" style={{ padding: '4px 14px' }}>
        <div className="panel-title" style={{ margin: '10px 0 0' }}>
          <span>{t('race.history')}</span>
        </div>
        {(history.data ?? []).length === 0 ? (
          <div className="muted small" style={{ padding: 12 }}>—</div>
        ) : (
          history.data!.map((r) => (
            <button key={r.id} className="list-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => setShowing(r)}>
              <span style={{ fontSize: 18 }}>{r.won ? '🏆' : '🏁'}</span>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {r.me.title} vs {r.opponent.user?.name ?? t('race.ghost')}
                </div>
                <div className="muted small">
                  {t('race.time', { s: (r.me.timeMs / 1000).toFixed(2) })} / {t('race.time', { s: (r.opponent.timeMs / 1000).toFixed(2) })}
                </div>
              </div>
              <b style={{ color: r.won ? 'var(--success)' : 'var(--muted)' }}>
                {r.payout > 0 ? `+${formatNumber(r.payout)}` : r.bet > 0 ? `−${formatNumber(r.bet)}` : ''}
              </b>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** Анимация дрэга: машины едут пропорционально серверному времени заезда. */
function RaceTrack({ race, onDone }: { race: RaceDto; onDone: () => void }) {
  const { t } = useT();
  const exclusive = useExclusiveColors();
  const [finished, setFinished] = useState(false);
  const slowest = Math.max(race.me.timeMs, race.opponent.timeMs);
  useEffect(() => {
    setFinished(false);
    const id = setTimeout(() => {
      setFinished(true);
      haptic.notify(race.won ? 'success' : 'warning');
      onDone();
    }, ANIMATION_MS + 150);
    return () => clearTimeout(id);
  }, [race.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lane = (r: RacerDto, label: string) => (
    <div className="lane">
      <span className="lane-label">
        {label} · {r.title}
      </span>
      <motion.div
        key={`${race.id}-${label}`}
        className="lane-car"
        initial={{ left: '0%' }}
        animate={{ left: 'calc(86% - 128px)' }}
        transition={{ duration: ((r.timeMs / slowest) * ANIMATION_MS) / 1000, ease: [0.55, 0, 0.75, 1] }}
      >
        <CarView archetype={archetypeOf(r)} tuning={r.tuning} exclusiveColors={exclusive} spinning={!finished} />
      </motion.div>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="track">
        {lane(race.opponent, race.opponent.user?.name ?? t('race.ghost'))}
        {lane(race.me, t('lb.you'))}
      </div>
      {finished && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`card center stack`}
          style={{ gap: 6, borderColor: race.won ? 'var(--success)' : 'var(--border)' }}
        >
          <b style={{ fontSize: 18, color: race.won ? 'var(--success)' : 'var(--text)' }}>{race.won ? t('race.win') : t('race.lose')}</b>
          <span className="muted small">
            {t('race.time', { s: (race.me.timeMs / 1000).toFixed(2) })} vs {t('race.time', { s: (race.opponent.timeMs / 1000).toFixed(2) })}
          </span>
          {race.payout > 0 && <b>{t('race.payout', { n: formatNumber(race.payout) })}</b>}
          {race.me.plate && (
            <div style={{ width: 160, alignSelf: 'center' }}>
              <Plate plate={race.me.plate} tier={race.me.plate.tier} glow={false} />
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
