import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LEADERBOARDS, type LeaderboardBoard } from '@nomer/shared';
import { api } from '../api';
import { Avatar, EmptyState, Skeleton } from '../components/ui';
import { formatNumber } from '../format';
import { useMe } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';

export function LeaderboardScreen() {
  const { t } = useT();
  const nav = useNav();
  const { data: me } = useMe();
  const [board, setBoard] = useState<LeaderboardBoard>('value');
  const lb = useQuery({ queryKey: ['leaderboard', board], queryFn: () => api.leaderboard(board), staleTime: 20_000 });

  const score = (n: number) => (board === 'legendary' ? `${n} ★` : board === 'races' ? `${n} 🏁` : formatNumber(n));

  return (
    <div className="screen stack">
      <div className="screen-title">{t('lb.title')}</div>
      <div className="chips-row">
        {LEADERBOARDS.map((b) => (
          <button key={b} className={`chip${board === b ? ' active' : ''}`} onClick={() => setBoard(b)}>
            {t(`lb.${b}`)}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: '4px 14px' }}>
        {lb.isPending ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="list-row">
              <Skeleton h={28} w={28} r={14} />
              <Skeleton h={14} />
            </div>
          ))
        ) : lb.data && lb.data.entries.length > 0 ? (
          lb.data.entries.map((e) => (
            <button
              key={e.user.id}
              className="list-row"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => nav.push({ name: 'userGarage', userId: e.user.id, userName: e.user.name })}
            >
              <span className={`rank${e.rank <= 3 ? ' top' : ''}`}>{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
              <Avatar user={e.user} size={32} />
              <span className="grow" style={{ fontWeight: e.user.id === me?.user.id ? 800 : 500 }}>
                {e.user.name}
              </span>
              <b>{score(e.score)}</b>
            </button>
          ))
        ) : (
          <EmptyState text={t('lb.empty')} />
        )}
      </div>

      {/* Своё место всегда закреплено внизу */}
      {me && lb.data && (
        <div className="card list-row pinned">
          <span className="rank">{lb.data.me.rank ?? '—'}</span>
          <Avatar user={me.user} size={32} />
          <span className="grow" style={{ fontWeight: 700 }}>
            {lb.data.me.rank ? t('lb.you') : t('lb.notRanked')}
          </span>
          <b>{score(lb.data.me.score)}</b>
        </div>
      )}
    </div>
  );
}
