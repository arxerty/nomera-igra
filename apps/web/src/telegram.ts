/** Тонкая типизированная обёртка над window.Telegram.WebApp (официальный SDK из index.html). */

type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type HapticNotification = 'error' | 'success' | 'warning';

interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  destructive_text_color?: string;
}

interface BottomButton {
  setText(text: string): BottomButton;
  show(): BottomButton;
  hide(): BottomButton;
  enable(): BottomButton;
  disable(): BottomButton;
  showProgress(leaveActive?: boolean): BottomButton;
  hideProgress(): BottomButton;
  setParams(params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): BottomButton;
  onClick(cb: () => void): BottomButton;
  offClick(cb: () => void): BottomButton;
}

interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string; language_code?: string } };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  isExpanded: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  disableVerticalSwipes?(): void;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: string, cb: (...args: unknown[]) => void): void;
  offEvent(event: string, cb: (...args: unknown[]) => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: BottomButton;
  HapticFeedback: {
    impactOccurred(style: HapticImpact): void;
    notificationOccurred(type: HapticNotification): void;
    selectionChanged(): void;
  };
  openInvoice(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  switchInlineQuery(query: string, chooseChatTypes?: ('users' | 'bots' | 'groups' | 'channels')[]): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  showAlert(message: string, cb?: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;

/** Запущено ли приложение внутри Telegram (есть подписанная initData). */
export const insideTelegram = Boolean(tg?.initData);

export function startParam(): string | null {
  return tg?.initDataUnsafe.start_param ?? null;
}

let hapticsEnabled = true;
export function setHapticsEnabled(v: boolean) {
  hapticsEnabled = v;
}

export const haptic = {
  impact(style: HapticImpact = 'light') {
    if (hapticsEnabled) tg?.HapticFeedback?.impactOccurred(style);
  },
  notify(type: HapticNotification) {
    if (hapticsEnabled) tg?.HapticFeedback?.notificationOccurred(type);
  },
  select() {
    if (hapticsEnabled) tg?.HapticFeedback?.selectionChanged();
  },
};

/** Подтверждение через нативный диалог Telegram, вне Telegram — window.confirm. */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg?.isVersionAtLeast('6.2')) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

export function openInvoice(url: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  return new Promise((resolve) => {
    if (tg?.isVersionAtLeast('6.1')) tg.openInvoice(url, resolve);
    else {
      window.open(url, '_blank');
      resolve('pending');
    }
  });
}

export function openTelegramLink(url: string) {
  if (tg) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

/** Поделиться номером через inline-режим бота. */
export function shareInline(query: string): boolean {
  if (tg?.isVersionAtLeast('6.7')) {
    tg.switchInlineQuery(query, ['users', 'groups', 'channels']);
    return true;
  }
  return false;
}

/** Применяет themeParams к CSS-переменным и следит за сменой темы. */
export function initTelegramTheme(apply: (scheme: 'light' | 'dark') => void) {
  // SDK создаёт WebApp и вне Telegram (со светлой темой по умолчанию) — там берём системную тему.
  if (!tg || !tg.initData) {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    apply(media.matches ? 'light' : 'dark');
    media.addEventListener('change', (e) => apply(e.matches ? 'light' : 'dark'));
    return;
  }
  const sync = () => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(tg.themeParams)) {
      if (value) root.style.setProperty(`--tg-${key.replace(/_/g, '-')}`, value);
    }
    apply(tg.colorScheme);
    try {
      tg.setHeaderColor('bg_color');
      tg.setBackgroundColor('bg_color');
    } catch {
      // старые клиенты
    }
  };
  sync();
  tg.onEvent('themeChanged', sync);
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
}
