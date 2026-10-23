import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { TIER_COLORS, TIER_NAMES, type PlateDto, type Tier, type UserPublicDto } from '@nomer/shared';
import { useT } from '../i18n';
import { formatNumber } from '../format';
import { Plate } from './Plate';

export function TierBadge({ tier }: { tier: Tier }) {
  const { locale } = useT();
  return (
    <span className="tier-badge" style={{ ['--c' as string]: TIER_COLORS[tier] }}>
      {TIER_NAMES[locale][tier]}
    </span>
  );
}

export function Coin({ value }: { value: number }) {
  return (
    <span className="row" style={{ gap: 5, display: 'inline-flex', fontWeight: 700 }}>
      <span className="coin" />
      {formatNumber(value)}
    </span>
  );
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function PlateTileSkeleton() {
  return (
    <div className="tile" style={{ borderLeftColor: 'var(--line)' }}>
      <Skeleton h={34} r={6} />
      <Skeleton h={12} w="60%" />
    </div>
  );
}

/** Компактная плитка номера в списках. */
export function PlateTile(props: { plate: PlateDto; price?: number; onClick?: () => void; selected?: boolean }) {
  const { plate, price, onClick, selected } = props;
  return (
    <button
      className="tile"
      style={{
        ['--c' as string]: TIER_COLORS[plate.tier],
        outline: selected ? `2px solid ${TIER_COLORS[plate.tier]}` : undefined,
      }}
      onClick={onClick}
    >
      <Plate plate={plate} />
      <div className="row between">
        <TierBadge tier={plate.tier} />
        {price !== undefined ? <Coin value={price} /> : <span className="muted small">{formatNumber(plate.value)}</span>}
      </div>
    </button>
  );
}

export function Avatar({ user, size = 36 }: { user: Pick<UserPublicDto, 'name' | 'photoUrl'>; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  return user.photoUrl ? (
    <img className="avatar" src={user.photoUrl} alt="" style={style} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar" style={style}>
      {user.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? 'active' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Нижний лист (bottom sheet). */
export function Sheet(props: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {props.open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={props.onClose}
          />
          <motion.div
            className="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="sheet-handle" />
            {props.title && <div className="screen-title" style={{ fontSize: 20 }}>{props.title}</div>}
            {props.children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Подгружает следующую страницу, когда низ списка появляется на экране. */
export function LoadMore(props: { hasMore: boolean; loading: boolean; onLoad: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { hasMore, loading, onLoad } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) onLoad();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoad]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="center" style={{ padding: 12 }}>
      <button className="btn btn-sm" onClick={onLoad} disabled={loading}>
        {loading ? t('common.loading') : t('loadMore')}
      </button>
    </div>
  );
}

// --- Тосты ---
interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
}
const ToastContext = createContext<(text: string, kind?: 'info' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const show = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now();
    setToast({ id, text, kind });
    setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 2800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.kind}`}
            initial={{ opacity: 0, y: -16, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -16, x: '-50%' }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="card center muted" style={{ padding: 28 }}>
      {text}
    </div>
  );
}
