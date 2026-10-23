import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { Locale } from '@nomer/shared';
import { api } from './api';
import { Skeleton, ToastProvider } from './components/ui';
import { useMe } from './hooks';
import { I18nContext, makeT, useT, type TKey } from './i18n';
import { NavProvider, useNav, type Route, type Tab } from './nav';
import { AuctionScreen } from './screens/Auction';
import { AchievementsScreen, AutoScreen, DreamScreen } from './screens/Auto';
import { CarCardScreen } from './screens/Cars';
import { ClubScreen, ClubsScreen } from './screens/Clubs';
import { ExhibitionScreen } from './screens/Exhibition';
import { GarageScreen, openGarageOn } from './screens/Garage';
import { RacesScreen } from './screens/Races';
import { ShowroomScreen } from './screens/Showroom';
import { TuningScreen } from './screens/Tuning';
import { HomeScreen } from './screens/Home';
import { LeaderboardScreen } from './screens/Leaderboard';
import { MarketScreen } from './screens/Market';
import { OddsScreen } from './screens/Odds';
import { PlateCardScreen } from './screens/PlateCard';
import { ProfileScreen } from './screens/Profile';
import { QuestsScreen } from './screens/Quests';
import { TradeCreateScreen, TradeScreen, TradesScreen } from './screens/Trades';
import { setSoundEnabled } from './sound';
import { insideTelegram, setHapticsEnabled, startParam } from './telegram';

/**
 * Экран по start_param: trade_<code> — предложение обмена, plate_<key> — карточка номера,
 * cars / races / auction / market — из уведомлений бота.
 */
function initialRoutes(): Route[] {
  const p = startParam();
  if (p?.startsWith('trade_')) return [{ name: 'trade', code: p.slice(6) }];
  if (p?.startsWith('plate_')) return [{ name: 'plate', id: p.slice(6) }];
  if (p === 'races') return [{ name: 'races' }];
  if (p === 'auction') return [{ name: 'auction' }];
  return [];
}

function initialTab(): Tab | undefined {
  const p = startParam();
  if (p === 'cars') {
    openGarageOn('cars');
    return 'garage';
  }
  if (p === 'market') return 'market';
  if (p === 'races' || p === 'auction') return 'auto';
  return undefined;
}

export function App() {
  const qc = useQueryClient();
  // Вход: initData проверяется на сервере, при первом входе создаётся игрок.
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.auth, retry: 1, staleTime: Infinity });
  useEffect(() => {
    if (auth.data) qc.setQueryData(['me'], auth.data);
  }, [auth.data, qc]);

  const locale: Locale = auth.data?.settings.locale ?? (navigator.language.startsWith('ru') ? 'ru' : 'en');

  if (auth.isError) {
    return (
      <I18nContext.Provider value={{ t: makeT(locale), locale }}>
        <div className="screen stack center" style={{ paddingTop: 80 }}>
          <div className="screen-title">{makeT(locale)('appName')}</div>
          <div className="muted">{insideTelegram ? String(auth.error.message) : makeT(locale)('common.needTelegram')}</div>
          <button className="btn btn-primary" onClick={() => void auth.refetch()}>
            {makeT(locale)('common.retry')}
          </button>
        </div>
      </I18nContext.Provider>
    );
  }
  if (!auth.data) {
    return (
      <div className="screen stack" style={{ paddingTop: 24 }}>
        <Skeleton h={36} w={180} r={18} />
        <Skeleton h={240} r={22} />
        <Skeleton h={78} r={20} />
      </div>
    );
  }

  return (
    <ToastProvider>
      <NavProvider initial={initialRoutes()} initialTab={initialTab()}>
        <Shell />
      </NavProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { data: me } = useMe();
  const locale: Locale = me?.settings.locale ?? 'ru';
  const i18n = useMemo(() => ({ t: makeT(locale), locale }), [locale]);

  useEffect(() => {
    if (!me) return;
    setSoundEnabled(me.settings.soundEnabled);
    setHapticsEnabled(me.settings.hapticsEnabled);
    document.documentElement.lang = locale;
  }, [me, locale]);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        {!insideTelegram && <div className="dev-banner">{i18n.t('common.devMode')}</div>}
        <Screens />
        <TabBar />
      </div>
    </I18nContext.Provider>
  );
}

function routeKey(r: Route): string {
  return JSON.stringify(r);
}

function Screens() {
  const { route, depth } = useNav();
  let screen: ReactNode;
  switch (route.name) {
    case 'home':
      screen = <HomeScreen />;
      break;
    case 'garage':
      screen = <GarageScreen />;
      break;
    case 'market':
      screen = <MarketScreen />;
      break;
    case 'leaderboard':
      screen = <LeaderboardScreen />;
      break;
    case 'quests':
      screen = <QuestsScreen />;
      break;
    case 'profile':
      screen = <ProfileScreen />;
      break;
    case 'odds':
      screen = <OddsScreen />;
      break;
    case 'trades':
      screen = <TradesScreen />;
      break;
    case 'plate':
      screen = <PlateCardScreen id={route.id} />;
      break;
    case 'trade':
      screen = <TradeScreen code={route.code} />;
      break;
    case 'tradeCreate':
      screen = <TradeCreateScreen offered={route.offered} requested={route.requested} />;
      break;
    case 'userGarage':
      screen = <GarageScreen userId={route.userId} title={route.userName} />;
      break;
    case 'auto':
      screen = <AutoScreen />;
      break;
    case 'car':
      screen = <CarCardScreen id={route.id} />;
      break;
    case 'tuning':
      screen = <TuningScreen carId={route.carId} />;
      break;
    case 'showroom':
      screen = <ShowroomScreen />;
      break;
    case 'races':
      screen = <RacesScreen />;
      break;
    case 'auction':
      screen = <AuctionScreen />;
      break;
    case 'exhibition':
      screen = <ExhibitionScreen />;
      break;
    case 'clubs':
      screen = <ClubsScreen />;
      break;
    case 'club':
      screen = <ClubScreen id={route.id} />;
      break;
    case 'dream':
      screen = <DreamScreen />;
      break;
    case 'achievements':
      screen = <AchievementsScreen />;
      break;
  }
  // Новый экран сразу заменяет старый и плавно въезжает — без паузы на анимацию выхода.
  return (
    <motion.div
      key={routeKey(route)}
      initial={{ opacity: 0.4, x: depth > 0 ? 18 : 0 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.16 }}
    >
      {screen}
    </motion.div>
  );
}

const TABS: { tab: Tab; icon: string }[] = [
  { tab: 'home', icon: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { tab: 'garage', icon: 'M2 10l10-6 10 6v10h-3v-8H5v8H2zM7 14h10M7 17h10' },
  { tab: 'auto', icon: 'M5 16l1.5-5A2 2 0 018.4 9.5h7.2a2 2 0 011.9 1.5L19 16M3 16h18v3H3zM7 19v1.5M17 19v1.5M7 16h.01M17 16h.01' },
  { tab: 'market', icon: 'M4 7h16l-1.5 11a2 2 0 01-2 2h-9a2 2 0 01-2-2zM9 7a3 3 0 016 0' },
  { tab: 'leaderboard', icon: 'M8 21V11H4v10zM14 21V5h-4v16zM20 21v-7h-4v7z' },
  { tab: 'quests', icon: 'M9 11l2 2 4-4M5 4h14v16H5z' },
];

function TabBar() {
  const { t } = useT();
  const { tab, depth, switchTab } = useNav();
  return (
    <nav className="tabbar">
      {TABS.map(({ tab: id, icon }) => (
        <button key={id} className={tab === id && depth === 0 ? 'active' : ''} onClick={() => switchTab(id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={icon} />
          </svg>
          {t(`tab.${id}` as TKey)}
        </button>
      ))}
    </nav>
  );
}
