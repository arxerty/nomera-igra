import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ACHIEVEMENT_NAMES, parseMask } from '@nomer/shared';
import { api } from '../api';
import { useCarsConfig } from '../components/cars';
import { MaskPlate } from '../components/Plate';
import { EmptyState, Skeleton, useToast } from '../components/ui';
import { formatDate } from '../format';
import { useAction } from '../hooks';
import { useT, type TKey } from '../i18n';
import { useNav, type Route } from '../nav';
import { haptic } from '../telegram';

const HUB: { route: Route; icon: string; title: TKey; text: TKey }[] = [
  { route: { name: 'showroom' }, icon: '🚘', title: 'auto.showroom', text: 'auto.showroomText' },
  { route: { name: 'races' }, icon: '🏁', title: 'auto.races', text: 'auto.racesText' },
  { route: { name: 'exhibition' }, icon: '🏆', title: 'auto.exhibition', text: 'auto.exhibitionText' },
  { route: { name: 'auction' }, icon: '🔨', title: 'auto.auction', text: 'auto.auctionText' },
  { route: { name: 'clubs' }, icon: '🤝', title: 'auto.clubs', text: 'auto.clubsText' },
  { route: { name: 'dream' }, icon: '✨', title: 'auto.dream', text: 'auto.dreamText' },
];

/** Вкладка «Авто»: вход в салон, гонки, выставку, аукцион, клубы. */
export function AutoScreen() {
  const { t } = useT();
  const nav = useNav();
  return (
    <div className="screen stack">
      <div className="screen-title">{t('auto.title')}</div>
      <div className="hub">
        {HUB.map((h) => (
          <button key={h.title} className="hub-tile" onClick={() => nav.push(h.route)}>
            <span className="icon">{h.icon}</span>
            <b>{t(h.title)}</b>
            <span className="muted small">{t(h.text)}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-block" onClick={() => nav.push({ name: 'achievements' })}>
        🎖️ {t('auto.achievements')}
      </button>
    </div>
  );
}

export function DreamScreen() {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: config } = useCarsConfig();
  const masks = useQuery({ queryKey: ['dreamMasks'], queryFn: api.dreamMasks });
  const [input, setInput] = useState('');
  const [busy, run] = useAction();
  const parsed = input.trim() ? parseMask(input.trim()) : null;

  const add = () =>
    run(async () => {
      await api.addDreamMask(input.trim());
      haptic.notify('success');
      toast(t('dream.added'));
      setInput('');
      await qc.invalidateQueries({ queryKey: ['dreamMasks'] });
    });
  const remove = (id: string) =>
    run(async () => {
      await api.deleteDreamMask(id);
      await qc.invalidateQueries({ queryKey: ['dreamMasks'] });
    });

  return (
    <div className="screen stack">
      <div className="screen-title">✨ {t('dream.title')}</div>
      <div className="muted small">{t('dream.text')}</div>
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row">
          <input
            className="grow"
            placeholder={t('market.mask')}
            value={input}
            maxLength={12}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            style={{ fontFamily: 'monospace', letterSpacing: '0.1em' }}
          />
          <button className="btn btn-primary" disabled={!parsed || busy} onClick={add}>
            {t('dream.add')}
          </button>
        </div>
        <span className="muted small">{t('market.maskHelp')}</span>
        {config && (
          <span className="muted small">{t('dream.limit', { n: config.dreamSearch.maxMasks, m: config.dreamSearch.minFixedChars })}</span>
        )}
        {parsed && (
          <div style={{ maxWidth: 280, alignSelf: 'center', width: '100%' }}>
            <MaskPlate body={parsed.body.map((c) => c ?? '*').join('')} region={parsed.region?.map((c) => c ?? '*').join('') ?? '**'} />
          </div>
        )}
      </div>
      {!masks.data ? (
        <Skeleton h={80} />
      ) : masks.data.length === 0 ? (
        <EmptyState text={t('dream.empty')} />
      ) : (
        masks.data.map((m) => {
          const [body, region] = m.mask.split(' ');
          return (
            <div key={m.id} className="card row">
              <div className="grow" style={{ maxWidth: 240 }}>
                <MaskPlate body={body!} region={region ?? '**'} />
              </div>
              <button className="btn btn-sm btn-danger-soft" disabled={busy} onClick={() => remove(m.id)}>
                ✕
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

export function AchievementsScreen() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const ach = useQuery({ queryKey: ['achievements'], queryFn: api.achievements });
  const [busy, run] = useAction();

  const choose = (id: Parameters<typeof api.setTitle>[0]) =>
    run(async () => {
      await api.setTitle(id);
      haptic.notify('success');
      toast(t('ach.titleSet'));
      await qc.invalidateQueries({ queryKey: ['achievements'] });
    });

  return (
    <div className="screen stack">
      <div className="screen-title">🎖️ {t('ach.title')}</div>
      {!ach.data ? (
        <Skeleton h={300} />
      ) : (
        <div className="card" style={{ padding: '4px 14px' }}>
          {ach.data.achievements.map((a) => {
            const name = ACHIEVEMENT_NAMES[locale][a.id];
            const isTitle = ach.data.title === a.id;
            return (
              <div key={a.id} className="list-row" style={{ opacity: a.earnedAt ? 1 : 0.5 }}>
                <span style={{ fontSize: 22 }}>{a.earnedAt ? '🏅' : '🔒'}</span>
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{name.title}</div>
                  <div className="muted small">
                    {name.hint} · {a.earnedAt ? t('ach.earned', { date: formatDate(a.earnedAt, locale) }) : t('ach.locked')}
                  </div>
                </div>
                {a.earnedAt &&
                  (isTitle ? (
                    <span className="combo-chip">{t('ach.isTitle')}</span>
                  ) : (
                    <button className="btn btn-sm btn-soft" disabled={busy} onClick={() => choose(a.id)}>
                      {t('ach.setTitle')}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
