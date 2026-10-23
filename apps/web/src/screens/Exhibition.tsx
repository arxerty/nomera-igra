import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { carModelTitle, type ExhibitionEntryDto, type VotePairDto } from '@nomer/shared';
import { api, ApiError } from '../api';
import { CarView } from '../components/CarView';
import { CarTile, useCarsConfig, useExclusiveColors } from '../components/cars';
import { Plate } from '../components/Plate';
import { Avatar, EmptyState, Skeleton, useToast } from '../components/ui';
import { formatDuration, formatNumber, useCountdown } from '../format';
import { useAction, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { sound } from '../sound';
import { haptic } from '../telegram';

export function ExhibitionScreen() {
  const { t } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const ex = useQuery({ queryKey: ['exhibition'], queryFn: api.exhibition });
  const cars = useQuery({ queryKey: ['cars'], queryFn: api.cars });
  const left = useCountdown(ex.data?.endsAt ?? null);
  const [carId, setCarId] = useState<string | null>(null);
  const [busy, run] = useAction();

  if (!ex.data || !cars.data) {
    return (
      <div className="screen stack">
        <Skeleton h={160} r={12} />
        <Skeleton h={220} r={12} />
      </div>
    );
  }
  const data = ex.data;
  const selected = carId ?? cars.data.cars[0]?.id ?? null;

  const enter = () =>
    run(async () => {
      if (!selected) return;
      qc.setQueryData(['exhibition'], await api.enterExhibition(selected));
      haptic.notify('success');
      toast(t('exh.entered'));
    });

  return (
    <div className="screen stack">
      <div>
        <div className="screen-title">🏆 {t('exh.title')}</div>
        <div className="muted small">
          {t('exh.text')} {t('exh.endsIn', { time: formatDuration(left ?? 0) })}
        </div>
      </div>

      {data.myEntry ? (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <b>{t('exh.myEntry')}</b>
            <span className="muted small">
              {t('exh.score', { w: data.myEntry.wins, s: data.myEntry.shows })}
              {data.myEntry.place ? ` · #${data.myEntry.place}` : ''}
            </span>
          </div>
          <CarTile car={data.myEntry.car} onClick={() => nav.push({ name: 'car', id: data.myEntry!.car.id })} />
        </div>
      ) : cars.data.cars.length === 0 ? (
        <button className="btn btn-primary btn-block" onClick={() => nav.push({ name: 'showroom' })}>
          {t('garage.toShowroom')}
        </button>
      ) : (
        <div className="card stack" style={{ gap: 8 }}>
          <b>{t('exh.pickCar')}</b>
          <div className="chips-row">
            {cars.data.cars.map((c) => (
              <button key={c.id} className={`chip${selected === c.id ? ' active' : ''}`} onClick={() => setCarId(c.id)}>
                {carModelTitle(c.model)}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !selected} onClick={enter}>
            {t('exh.enter')}
          </button>
        </div>
      )}

      {data.canVote ? <VoteBlock rewardedLeft={data.rewardedVotesLeft} /> : <div className="note info">{t('exh.cantVote')}</div>}

      <EntryList title={t('exh.top')} entries={data.top} />
      {data.previousTop.length > 0 && <EntryList title={t('exh.prevTop')} entries={data.previousTop} />}
    </div>
  );
}

function VoteBlock({ rewardedLeft }: { rewardedLeft: number }) {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const exclusive = useExclusiveColors();
  const { data: config } = useCarsConfig();
  const pair = useQuery({
    queryKey: ['votePair'],
    queryFn: () =>
      api.votePair().catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'vote_not_allowed') return { pair: null } as VotePairDto;
        throw e;
      }),
    staleTime: Infinity,
  });
  const [busy, run] = useAction();

  const vote = (entryId: string) =>
    run(async () => {
      const res = await api.vote(entryId);
      haptic.impact('light');
      if (res.rewarded && res.chips !== null) {
        patchBalance({ chips: res.chips });
        sound.coin();
      }
      toast(res.rewarded && config ? t('exh.votedReward', { n: formatNumber(config.exhibition.voteRewardChips) }) : t('exh.voted'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['votePair'] }), qc.invalidateQueries({ queryKey: ['exhibition'] })]);
    });

  const entries = pair.data?.pair;
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="panel-title" style={{ marginBottom: 0 }}>
        <span>🔥 {t('exh.vote')}</span>
      </div>
      <span className="muted small">{t('exh.voteHint', { n: rewardedLeft })}</span>
      {pair.isPending ? (
        <Skeleton h={160} />
      ) : !entries ? (
        <div className="muted small center">{t('exh.noPair')}</div>
      ) : (
        <div className="vs">
          {entries.map((e) => (
            <button key={e.id} disabled={busy} onClick={() => vote(e.id)}>
              <span className="car-name">{carModelTitle(e.car.model)}</span>
              <CarView archetype={e.car.model.archetype} tuning={e.car.tuning} exclusiveColors={exclusive} />
              {e.car.plate && <Plate plate={e.car.plate} tier={e.car.plate.tier} glow={false} />}
              <span className="muted small">{e.owner.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryList({ title, entries }: { title: string; entries: ExhibitionEntryDto[] }) {
  const { t } = useT();
  const nav = useNav();
  return (
    <div className="card" style={{ padding: '4px 14px' }}>
      <div className="panel-title" style={{ margin: '10px 0 0' }}>
        <span>{title}</span>
      </div>
      {entries.length === 0 ? (
        <EmptyState text={t('exh.empty')} />
      ) : (
        entries.map((e, i) => (
          <button key={e.id} className="list-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.push({ name: 'car', id: e.car.id })}>
            <span className={`rank${(e.place ?? i + 1) <= 3 ? ' top' : ''}`}>{e.place ?? '—'}</span>
            <Avatar user={e.owner} size={28} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{carModelTitle(e.car.model)}</div>
              <div className="muted small">{e.owner.name}</div>
            </div>
            <span className="small">{t('exh.score', { w: e.wins, s: e.shows })}</span>
          </button>
        ))
      )}
    </div>
  );
}
