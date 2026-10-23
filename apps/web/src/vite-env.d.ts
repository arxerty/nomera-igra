/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API; по умолчанию /api (в dev проксируется Vite на localhost:3000). */
  readonly VITE_API_URL?: string;
  /** Только для разработки вне Telegram: вход как этот Telegram ID (нужен DEV_AUTH=true на API). */
  readonly VITE_DEV_TELEGRAM_ID?: string;
}
