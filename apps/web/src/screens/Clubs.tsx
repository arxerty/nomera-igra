import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ClubDto } from '@nomer/shared';
import { api } from '../api';
import { useCarsConfig } from '../components/cars';
import { Avatar, EmptyState, Skeleton, useToast } from '../components/ui';
import { formatNumber } from '../format';
import { useAction, useMe, usePatchBalance } from '../hooks';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { confirmDialog, haptic, openTelegramLink } from '../telegram';

export function ClubsScreen() {
  const { t } = useT();
  const nav = useNav();
  const mine = useQuery({ queryKey: ['myClub'], queryFn: api.myClub });
  const top = useQuery({ queryKey: ['clubs'], queryFn: api.clubs });

  return (
    <div className="screen stack">
      <div className="screen-title">🤝 {t('club.title')}</div>
      {mine.isPending ? <Skeleton h={160} r={12} /> : mine.data?.club ? <ClubView club={mine.data.club} /> : <CreateClub />}

      <div className="card" style={{ padding: '4px 14px' }}>
        <div className="panel-title" style={{ margin: '10px 0 0' }}>
          <span>{t('club.top')}</span>
        </div>
        {!top.data ? (
          <Skeleton h={80} />
        ) : top.data.length === 0 ? (
          <EmptyState text={t('club.empty')} />
        ) : (
          top.data.map((c) => (
            <button key={c.id} className="list-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav.push({ name: 'club', id: c.id })}>
              <span className={`rank${c.rank <= 3 ? ' top' : ''}`}>{c.rank}</span>
              <span className="grow" style={{ fontWeight: 600 }}>
                {c.name} <span className="muted small">· {c.memberCount}</span>
              </span>
              <b>{formatNumber(c.rating)}</b>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function ClubScreen({ id }: { id: string }) {
  const club = useQuery({ queryKey: ['club', id], queryFn: () => api.club(id) });
  return <div className="screen stack">{club.data ? <ClubView club={club.data} /> : <Skeleton h={200} r={12} />}</div>;
}

function CreateClub() {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const patchBalance = usePatchBalance();
  const { data: config } = useCarsConfig();
  const [name, setName] = useState('');
  const [chat, setChat] = useState('');
  const [busy, run] = useAction();
  if (!config) return null;

  const create = () =>
    run(async () => {
      const club = await api.createClub(name.trim(), chat.trim() || null);
      patchBalance({ chips: (await api.me()).chips });
      haptic.notify('success');
      toast(t('club.created'));
      qc.setQueryData(['myClub'], { club });
      void qc.invalidateQueries({ queryKey: ['clubs'] });
    });

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <input placeholder={t('club.name')} value={name} maxLength={config.clubs.nameMaxLength} onChange={(e) => setName(e.target.value)} />
      <input placeholder={t('club.chat')} value={chat} onChange={(e) => setChat(e.target.value)} />
      <button
        className="btn btn-primary btn-block"
        disabled={busy || name.trim().length < config.clubs.nameMinLength}
        onClick={create}
      >
        {t('club.create', { n: formatNumber(config.clubs.createCostChips) })}
      </button>
    </div>
  );
}

function ClubView({ club }: { club: ClubDto }) {
  const { t } = useT();
  const nav = useNav();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const myClub = useQuery({ queryKey: ['myClub'], queryFn: api.myClub });
  const [chat, setChat] = useState(club.chatLink ?? '');
  const [busy, run] = useAction();
  const isOwner = club.members.some((m) => m.role === 'owner' && m.user.id === me?.user.id);
  const canJoin = !club.isMember && myClub.data?.club === null && club.members.length < club.maxMembers;

  const refresh = (updated?: ClubDto) => {
    if (updated) qc.setQueryData(['club', updated.id], updated);
    void qc.invalidateQueries({ queryKey: ['myClub'] });
    void qc.invalidateQueries({ queryKey: ['clubs'] });
    void qc.invalidateQueries({ queryKey: ['club', club.id] });
  };

  const join = () =>
    run(async () => {
      refresh(await api.joinClub(club.id));
      haptic.notify('success');
      toast(t('club.joined'));
    });
  const leave = () =>
    run(async () => {
      if (!(await confirmDialog(t('club.leaveConfirm')))) return;
      await api.leaveClub();
      refresh();
      if (nav.depth > 0) nav.back();
    });
  const saveChat = () =>
    run(async () => {
      refresh(await api.updateClubChat(chat.trim() || null));
      toast(t('common.ok'));
    });
  const kick = (userId: string) =>
    run(async () => {
      refresh(await api.kickMember(userId));
    });

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <b style={{ fontSize: 18 }}>{club.name}</b>
          {club.rank && <span className="tier-badge" style={{ ['--c' as string]: 'var(--accent)' }}>#{club.rank}</span>}
        </div>
        <div className="row between">
          <span className="muted">{t('club.rating')}</span>
          <b>{formatNumber(club.rating)}</b>
        </div>
        {club.chatLink && (
          <button className="btn btn-soft btn-block" onClick={() => openTelegramLink(club.chatLink!)}>
            💬 {t('club.openChat')}
          </button>
        )}
        {canJoin && (
          <button className="btn btn-primary btn-block" disabled={busy} onClick={join}>
            {t('club.join')}
          </button>
        )}
        {club.isMember && (
          <button className="btn btn-block btn-danger" disabled={busy} onClick={leave}>
            {t('club.leave')}
          </button>
        )}
      </div>

      {isOwner && (
        <div className="card row">
          <input className="grow" placeholder={t('club.chat')} value={chat} onChange={(e) => setChat(e.target.value)} />
          <button className="btn btn-soft" disabled={busy} onClick={saveChat}>
            {t('club.saveChat')}
          </button>
        </div>
      )}

      <div className="card" style={{ padding: '4px 14px' }}>
        <div className="panel-title" style={{ margin: '10px 0 0' }}>
          <span>{t('club.members', { n: club.members.length, max: club.maxMembers })}</span>
        </div>
        {club.members.map((m) => (
          <div key={m.user.id} className="list-row">
            <button className="row grow" style={{ textAlign: 'left' }} onClick={() => nav.push({ name: 'userGarage', userId: m.user.id, userName: m.user.name })}>
              <Avatar user={m.user} size={30} />
              <span className="grow">
                <span style={{ fontWeight: 600 }}>{m.user.name}</span>
                {m.role === 'owner' && <span className="muted small"> · {t('club.owner')}</span>}
              </span>
            </button>
            <b className="small">{formatNumber(m.value)}</b>
            {isOwner && m.role !== 'owner' && (
              <button className="btn btn-sm btn-danger-soft" disabled={busy} onClick={() => kick(m.user.id)}>
                {t('club.kick')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
