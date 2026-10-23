import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Skeleton, useToast } from '../components/ui';
import { formatDuration, rewardText, useCountdown } from '../format';
import { useApiError, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { sound } from '../sound';
import { haptic } from '../telegram';

export function QuestsScreen() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const onError = useApiError();
  const patchBalance = usePatchBalance();
  const quests = useQuery({ queryKey: ['quests'], queryFn: api.quests });
  const [busy, setBusy] = useState<string | null>(null);
  const resetIn = useCountdown(quests.data?.daily.resetsAt ?? null);

  async function claim(id: string, action: () => Promise<{ chips: number; rolls: number }>, reward: string) {
    setBusy(id);
    try {
      patchBalance(await action());
      sound.coin();
      haptic.notify('success');
      toast(t('quests.reward', { reward }));
      await qc.invalidateQueries({ queryKey: ['quests'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  if (!quests.data) {
    return (
      <div className="screen stack">
        <Skeleton h={30} w={160} />
        <Skeleton h={150} r={16} />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} h={72} r={16} />
        ))}
      </div>
    );
  }

  const { daily } = quests.data;
  const cycleDay = daily.streak % 7;

  return (
    <div className="screen stack">
      <div className="screen-title">{t('quests.title')}</div>

      <div className="card stack" style={{ gap: 10, borderColor: daily.canClaim ? 'var(--tier-legendary)' : undefined }}>
        <div className="row between">
          <b>🎁 {t('quests.daily')}</b>
          <span className="muted small">{t('quests.streak', { n: daily.streak })}</span>
        </div>
        <div className="streak">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={i < cycleDay || (cycleDay === 0 && daily.streak > 0 && !daily.canClaim) ? 'done' : i === cycleDay && daily.canClaim ? 'next' : ''}>
              {i + 1}
            </div>
          ))}
        </div>
        <div className="row between">
          <span className="small">{t('quests.nextReward', { reward: rewardText(daily.nextReward, locale) })}</span>
          <button
            className="btn btn-primary btn-sm"
            disabled={!daily.canClaim || busy !== null}
            onClick={() => claim('daily', api.claimDaily, rewardText(daily.nextReward, locale))}
          >
            {daily.canClaim ? t('quests.claim') : t('quests.claimed')}
          </button>
        </div>
      </div>

      <div className="row between">
        <b>{t('quests.today')}</b>
        {resetIn !== null && <span className="muted small">{t('quests.resetsIn', { time: formatDuration(resetIn) })}</span>}
      </div>

      {quests.data.quests.map((q) => {
        const done = q.progress >= q.target;
        const reward = rewardText({ chips: q.rewardChips, rolls: q.rewardRolls }, locale);
        return (
          <div key={q.id} className="card stack" style={{ gap: 8, opacity: q.claimed ? 0.6 : 1 }}>
            <div className="row between">
              <span style={{ fontWeight: 600 }}>{q.title}</span>
              <span className="small" style={{ color: 'var(--tier-legendary)' }}>+{reward}</span>
            </div>
            <div className="row">
              <div className="progress grow">
                <div style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }} />
              </div>
              <span className="small muted">
                {q.progress}/{q.target}
              </span>
              {done && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={q.claimed || busy !== null}
                  onClick={() => claim(q.id, () => api.claimQuest(q.id), reward)}
                >
                  {q.claimed ? t('quests.claimed') : t('quests.claim')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
