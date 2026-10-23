import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { haptic, tg } from './telegram';

export type Tab = 'home' | 'garage' | 'auto' | 'market' | 'leaderboard' | 'quests';

export type Route =
  | { name: Tab }
  | { name: 'profile' }
  | { name: 'odds' }
  | { name: 'trades' }
  | { name: 'plate'; id: string }
  | { name: 'trade'; code: string }
  | { name: 'tradeCreate'; offered?: string[]; requested?: string[] }
  | { name: 'userGarage'; userId: string; userName: string }
  | { name: 'car'; id: string }
  | { name: 'tuning'; carId: string }
  | { name: 'showroom' }
  | { name: 'races' }
  | { name: 'auction' }
  | { name: 'exhibition' }
  | { name: 'clubs' }
  | { name: 'club'; id: string }
  | { name: 'dream' }
  | { name: 'achievements' };

interface Nav {
  tab: Tab;
  route: Route;
  depth: number;
  push: (r: Route) => void;
  back: () => void;
  switchTab: (t: Tab) => void;
}

const NavContext = createContext<Nav | null>(null);

/** Навигация: вкладки + стек экранов поверх. Глубина стека управляет Telegram BackButton. */
export function NavProvider({ children, initial, initialTab }: { children: ReactNode; initial?: Route[]; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'home');
  const [stack, setStack] = useState<Route[]>(initial ?? []);

  const push = useCallback((r: Route) => {
    haptic.select();
    setStack((s) => [...s, r]);
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const switchTab = useCallback((t: Tab) => {
    haptic.select();
    setTab(t);
    setStack([]);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const app = tg;
    if (!app) return;
    if (stack.length > 0) {
      app.BackButton.show();
      app.BackButton.onClick(back);
      return () => app.BackButton.offClick(back);
    }
    app.BackButton.hide();
  }, [stack.length, back]);

  const value = useMemo<Nav>(
    () => ({ tab, route: stack.at(-1) ?? { name: tab }, depth: stack.length, push, back, switchTab }),
    [tab, stack, push, back, switchTab],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavProvider missing');
  return nav;
}

/**
 * Telegram MainButton для главного действия экрана. Возвращает false вне Telegram —
 * тогда экран рисует обычную кнопку.
 */
export function useMainButton(cfg: { text: string; onClick: () => void; disabled?: boolean; progress?: boolean; color?: string } | null): boolean {
  const native = Boolean(tg?.initData);
  const onClickRef = useRef(cfg?.onClick);
  onClickRef.current = cfg?.onClick;

  useEffect(() => {
    const app = tg;
    if (!native || !app || !cfg) return;
    const handler = () => onClickRef.current?.();
    app.MainButton.onClick(handler);
    return () => {
      app.MainButton.offClick(handler);
      app.MainButton.hide();
    };
  }, [native, cfg === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!native || !tg || !cfg) return;
    tg.MainButton.setParams({ text: cfg.text, is_active: !cfg.disabled, is_visible: true, ...(cfg.color ? { color: cfg.color } : {}) });
    if (cfg.progress) tg.MainButton.showProgress(false);
    else tg.MainButton.hideProgress();
  }, [native, cfg?.text, cfg?.disabled, cfg?.progress, cfg?.color]); // eslint-disable-line react-hooks/exhaustive-deps

  return native;
}
