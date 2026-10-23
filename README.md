# Номерной Фарт

Telegram Mini App: игрок выбивает случайные российские автомобильные номера, собирает коллекцию красивых номеров, продаёт и обменивает их и соревнуется в рейтинге.

- Номера генерирует **только сервер** криптостойким ГПСЧ; клиент лишь проигрывает анимацию до полученного результата.
- Каждый номер существует в игре в одном экземпляре. Проданный системе номер возвращается в пул и может выпасть снова — его «паспорт» (история владельцев) сохраняется.
- Шесть уровней редкости: Обычный → Необычный → Редкий → Эпический → Легендарный → Мифический. Шансы, VIP-серии, регионы и цены настраиваются через админ-API и показываются игрокам на экране «Шансы».
- Внутренняя валюта — **Фишки**. Telegram Stars — только для покупки попыток; вывода в реальные деньги нет.

## Содержание

1. [Архитектура](#архитектура)
2. [Быстрый старт (локально)](#быстрый-старт-локально)
3. [Настройка бота в BotFather](#настройка-бота-в-botfather)
4. [Открыть игру из Telegram локально](#открыть-игру-из-telegram-локально)
5. [Деплой на сервер](#деплой-на-сервер)
6. [Переменные окружения](#переменные-окружения)
7. [Тесты](#тесты)
8. [Игровые правила и где их менять](#игровые-правила-и-где-их-менять)
9. [Админ-API](#админ-api)
10. [API для Mini App](#api-для-mini-app)
11. [Надёжность и безопасность](#надёжность-и-безопасность)

## Архитектура

```
packages/shared   общая логика на TypeScript, без зависимостей от рантайма
  plate.ts          формат номера, разбор и вывод (латиница → кириллица)
  rarity.ts         определение редкости и бонусов
  generator.ts      генерация номера нужного тира, выбор тира по шансам
  pricing.ts        цена продажи системе, комиссия рынка
  config.ts         конфиг игры (zod-схема) и значения по умолчанию
  mask.ts           поиск по маске «*777** 77»
  plate-render.ts   векторная отрисовка таблички (Mini App и PNG-карточки)
  api.ts            DTO, общие для API, Mini App и бота

apps/api          Fastify + Prisma (PostgreSQL) + Redis + BullMQ
apps/web          Mini App: React + Vite, Telegram WebApp SDK
apps/bot          grammY: запуск Mini App, оплата Stars, уведомления, inline-шаринг
```

```
Telegram ──initData──▶ Mini App (web) ──/api──▶ API ──▶ PostgreSQL
                                                  │
                                                  ├──▶ Redis: рейтинги, лимиты, кеш конфига
                                                  └──▶ BullMQ «notifications» ──▶ бот ──▶ Telegram
Telegram ──updates──▶ бот ──/internal (токен)──▶ API   (оплата Stars, данные для шаринга)
```

- **PostgreSQL** — источник истины: игроки, номера, паспорта, лоты, обмены, платежи, журнал баланса (`LedgerEntry`), журналы выбиваний (`RollLog`) и сделок (`DealLog`), версии конфига.
- **Redis** — рейтинги (ZSET), rate limiting и кулдауны, кеш активного конфига, очереди BullMQ.
- Таймер бесплатной попытки хранится в PostgreSQL: это игровая ценность, потеря Redis не должна раздавать попытки.

## Быстрый старт (локально)

Нужны **Node.js 20+** и **Docker Desktop**.

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
docker compose up -d postgres redis
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Сид создаёт 10 тестовых игроков с коллекциями всех редкостей, лоты на рынке, историю сделок и активное предложение обмена. Перезалить с нуля: `npm run db:seed -- --reset`. Чтобы получить в игре собственного игрока с хорошей коллекцией, задайте в `.env` переменную `SEED_TELEGRAM_ID=<ваш Telegram ID>` и запустите сид ещё раз (узнать ID можно у [@userinfobot](https://t.me/userinfobot)).

Запуск — в трёх терминалах:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

```bash
npm run dev:bot
```

### Без Telegram, в обычном браузере

В `.env`:

```
DEV_AUTH=true
VITE_DEV_TELEGRAM_ID=7000000001
ADMIN_TELEGRAM_IDS=7000000001
```

Откройте http://localhost:5173 — вы войдёте как тестовый игрок «Гоша Блатной» (ID `7000000001`…`7000000010` — сид-игроки). Сверху будет жёлтая плашка «Режим разработки». `DEV_AUTH` работает только при `NODE_ENV≠production`. Боту для этого режима не нужен настоящий токен — достаточно не запускать `dev:bot`.

## Настройка бота в BotFather

1. `/newbot` — создайте бота, токен положите в `BOT_TOKEN`, имя без `@` — в `BOT_USERNAME`.
2. `/newapp` — создайте Mini App для бота: укажите HTTPS-адрес фронтенда (тот же, что `WEB_APP_URL`) и короткое имя (оно идёт в `MINI_APP_SHORT_NAME`, ссылки вида `t.me/<бот>/<имя>`).
3. `/setinline` — включите inline-режим (нужен для «Поделиться номером»). Плейсхолдер, например: `Номер, например А777АА77`.
4. Оплата в Telegram Stars не требует платёжного провайдера: бот выставляет инвойсы в валюте `XTR`.

Кнопку меню чата и список команд бот выставляет сам при старте.

## Открыть игру из Telegram локально

Telegram открывает Mini App только по HTTPS. Самый простой путь — туннель на dev-сервер Vite (он сам проксирует `/api` на API):

```bash
cloudflared tunnel --url http://localhost:5173
```

Полученный адрес `https://….trycloudflare.com`:

- укажите в BotFather как URL Mini App (`/myapps` → ваше приложение → Edit Web App URL);
- пропишите в `.env` как `WEB_APP_URL` и `PUBLIC_API_URL` и перезапустите `npm run dev:bot`.

Туннели `*.trycloudflare.com` и `*.ngrok-free.app` уже разрешены в `apps/web/vite.config.ts`. Для входа из Telegram выключите `DEV_AUTH` или не задавайте `VITE_DEV_TELEGRAM_ID` — тогда используется настоящая `initData`.

## Деплой на сервер

Нужен сервер с Docker и домен, A-запись которого указывает на сервер.

1. Склонируйте репозиторий и создайте `.env` из `.env.example`. Обязательно:

   ```
   NODE_ENV=production
   APP_DOMAIN=game.example.com
   WEB_APP_URL=https://game.example.com
   PUBLIC_API_URL=https://game.example.com
   BOT_WEBHOOK_URL=https://game.example.com/telegram
   BOT_WEBHOOK_SECRET=<случайная строка из латиницы и цифр>
   INTERNAL_API_TOKEN=<длинная случайная строка>
   POSTGRES_PASSWORD=<надёжный пароль>
   DEV_AUTH=false
   ```

   `DATABASE_URL` и `REDIS_URL` для контейнеров compose собирает сам из `POSTGRES_*`.

2. Запустите:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

   Caddy получит сертификат Let's Encrypt для `APP_DOMAIN` и будет отдавать Mini App на `https://<домен>/` и webhook бота на `https://<домен>/telegram`. Наружу открыты только порты 80 и 443. Миграции БД применяются автоматически при каждом старте API.

3. В BotFather укажите `https://<домен>` как URL Mini App.

Обновление: `git pull` и та же команда `up -d --build`. Сиды предназначены только для локальной разработки и в продакшен-образ не входят.

Бэкап базы:

```bash
docker compose exec -T postgres pg_dump -U nomer nomer > backup.sql
```

## Переменные окружения

| Переменная | Где | Описание |
|---|---|---|
| `BOT_TOKEN` | api, bot | Токен бота. API проверяет им подпись `initData` и создаёт инвойсы |
| `BOT_USERNAME`, `MINI_APP_SHORT_NAME` | api, bot | Для ссылок `t.me/<бот>/<приложение>?startapp=…` |
| `INTERNAL_API_TOKEN` | api, bot | Секрет для запросов бот → API (`/internal/*`) |
| `ADMIN_TELEGRAM_IDS` | api | Telegram ID администраторов через запятую |
| `DATABASE_URL`, `REDIS_URL` | api, bot | Подключения к PostgreSQL и Redis |
| `INIT_DATA_MAX_AGE_SEC` | api | Срок годности `initData`, по умолчанию сутки |
| `CORS_ORIGIN` | api | Разрешённые источники; при одном домене через nginx не нужен |
| `DEV_AUTH` | api | Вход без Telegram (`Authorization: dev <id>`), только вне production |
| `WEB_APP_URL` | bot | HTTPS-адрес Mini App |
| `PUBLIC_API_URL` | bot | Публичный адрес для PNG-карточек при шаринге; пусто — шаринг текстом |
| `API_INTERNAL_URL` | bot | Адрес API изнутри сети (в compose — `http://api:3000`) |
| `BOT_WEBHOOK_URL`, `BOT_WEBHOOK_SECRET` | bot | Webhook вместо long polling |
| `APP_DOMAIN` | caddy | Домен для HTTPS в продакшене |
| `VITE_API_URL`, `VITE_DEV_TELEGRAM_ID` | web | Базовый URL API (по умолчанию `/api`), вход без Telegram в dev |
| `SEED_TELEGRAM_ID` | сид | Создать своего игрока при `db:seed` |
| `TEST_DATABASE_URL`, `TEST_REDIS_URL` | тесты | Отдельные БД и Redis для интеграционных тестов |

## Тесты

```bash
npm test
```

Юнит-тесты всех пакетов: генерация и формат номера, редкость (все уровни и пограничные случаи), цены, маски, игровое время, отрисовка таблички, проверка подписи `initData`, тексты бота.

```bash
npm run test:int
```

Интеграционные тесты API на настоящих PostgreSQL и Redis (база `nomer_test` создаётся контейнером автоматически): вход и рефералы, выбивание (включая 10 параллельных при 3 попытках), рынок (включая двух одновременных покупателей одного лота), обмены, продажа системе, задания, оплата Stars (начисление ровно один раз), рейтинг, админка.

## Игровые правила и где их менять

Логика — в `packages/shared`, значения по умолчанию — в `packages/shared/src/config.ts`, активный конфиг — в БД (правится через админ-API без перезапуска).

| Уровень | Признаки | Шанс по умолчанию | Цена |
|---|---|---|---|
| Обычный | без закономерностей | 64% | 10 |
| Необычный | две одинаковые цифры подряд (А112ВС), зеркальные (А121ВС) | 25% | 40 |
| Редкий | три одинаковые (А555ВС), круглые (А100ВС), последовательности (А123ВС, А321ВС) | 8.5% | 150 |
| Эпический | три одинаковые буквы (А123АА), цифры 001–009 | 2% | 600 |
| Легендарный | одинаковые буквы и цифры (А777АА), VIP-серия | 0.45% | 3 000 |
| Мифический | одинаковые буквы + 001/777 + столичный регион (А001АА 77) | 0.05% | 25 000 |

- Уровень определяется по наивысшему совпавшему признаку.
- Бонусы к цене (перемножаются): совпадение цифр с регионом (А077ВС 77) ×1.5, палиндром (первая буква равна последней и цифры-палиндром: А121ВА) ×1.3.
- Генерация: сервер выбирает тир по весам, затем строит номер именно этого тира и перепроверяет его классификатором. Внутри тира разные «виды» номеров равновероятны (у легендарки — А777АА и VIP-серия). Если свободных номеров тира не осталось, выпадает лучший из доступных ниже.
- Попытка за Фишки (100) дороже средней выручки с выбивания (~67), поэтому бесконечный цикл «купил — выбил — продал» невыгоден.

## Админ-API

Все запросы — с заголовком `Authorization: tma <initData>` администратора (Telegram ID из `ADMIN_TELEGRAM_IDS`). Локально удобнее `Authorization: dev <id>` при `DEV_AUTH=true`.

| Запрос | Что делает |
|---|---|
| `GET /api/admin/config` | Активный конфиг и его версия |
| `PATCH /api/admin/config` | Частичная правка: секции сливаются на один уровень, массивы заменяются |
| `PUT /api/admin/config` | Полная замена конфига |
| `GET /api/admin/config/history` | История версий |
| `POST /api/admin/recompute` | Пересчитать редкость и цены всех номеров по текущему конфигу и пересобрать рейтинги |
| `GET /api/admin/users/:telegramId` | Карточка игрока |
| `GET /api/admin/users/:telegramId/audit?kind=rolls\|deals\|ledger\|payments` | Журналы игрока для разбора жалоб |
| `POST /api/admin/users/:telegramId/adjust` | Ручная корректировка баланса с комментарием |

Примеры:

```bash
curl -X PATCH http://localhost:3000/api/admin/config -H "Authorization: dev 7000000001" -H "Content-Type: application/json" -d "{\"odds\":{\"mythic\":1000}}"
```

```bash
curl -X PATCH http://localhost:3000/api/admin/config -H "Authorization: dev 7000000001" -H "Content-Type: application/json" -d "{\"rarity\":{\"vipSeries\":[{\"letters\":\"ЕКХ\"},{\"letters\":\"АМР\",\"regions\":[\"77\",\"97\"]}]}}"
```

После правки VIP-серий, столичных регионов или цен вызовите `POST /api/admin/recompute`, чтобы обновить уже выданные номера.

Некорректный конфиг не сохранится: ответ `400` с описанием ошибки.

## API для Mini App

Все запросы — с `Authorization: tma <initData>`; подпись проверяется на каждом запросе.

| Группа | Эндпоинты |
|---|---|
| Вход | `POST /api/auth` (создаёт игрока при первом входе, учитывает `start_param=ref_<id>`) |
| Главная | `GET /api/me`, `POST /api/roll`, `POST /api/rolls/buy`, `POST /api/payments/invoice` |
| Гараж | `GET /api/garage`, `GET /api/garage/summary`, `GET /api/plates/:idOrKey`, `POST /api/plates/:id/sell`, `GET /api/users/:id/garage` |
| Рынок | `GET /api/market?mask=*777**&region=77&tier=&sort=`, `POST /api/market/listings`, `DELETE /api/market/listings/:id`, `POST /api/market/listings/:id/buy` |
| Обмены | `GET /api/trades`, `POST /api/trades`, `GET /api/trades/:code`, `POST /api/trades/:code/accept\|decline\|cancel` |
| Прочее | `GET /api/leaderboard?board=value\|legendary\|weekly`, `GET /api/quests`, `POST /api/quests/:id/claim`, `POST /api/daily/claim`, `GET /api/profile`, `PATCH /api/profile/settings`, `GET /api/odds` |
| Публичные | `GET /health`, `GET /cards/<номер>.png` (карточка для шаринга) |

Ошибки — `{ "error": { "code": "...", "message": "..." } }`, коды перечислены в `packages/shared/src/api.ts`.

## Надёжность и безопасность

- **Авторизация:** подпись `initData` (HMAC по токену бота) и её срок проверяются на каждом запросе; игрок определяется по Telegram ID.
- **Без двойных списаний:** баланс меняется одним `UPDATE … WHERE balance + delta >= 0`; лоты, предложения и номера блокируются `FOR UPDATE` в фиксированном порядке; при дедлоке транзакция повторяется. Дополнительно в БД стоят CHECK-ограничения на неотрицательные балансы.
- **Уникальность номеров:** атомарный `INSERT … ON CONFLICT` по ключу номера.
- **Оплата Stars:** `pre_checkout_query` сверяется с заказом; `successful_payment` идёт через очередь с повторами и начисляется ровно один раз (уникальный `telegram_payment_charge_id`).
- **Rate limiting в Redis:** кулдаун 1.5 с на выбивание, лимиты на выбивание, рынок, обмены и все запросы игрока.
- **Аудит:** `RollLog` (каждое выбивание: выпавший и итоговый тир, источник попытки, версия конфига), `DealLog` (все сделки), `LedgerEntry` (каждое изменение баланса с остатком после операции).
- Вся логика наград, цен и редкости выполняется только на сервере.
