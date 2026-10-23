import {
  TIER_NAMES,
  formatPlate,
  type Locale,
  type NotificationJob,
  type PlateCardDto,
  type Tier,
} from '@nomer/shared';

const TIER_EMOJI: Record<Tier, string> = {
  common: '⚪',
  uncommon: '🟢',
  rare: '🔵',
  epic: '🟣',
  legendary: '🟡',
  mythic: '🔴',
};

export function localeOf(languageCode: string | undefined): Locale {
  return languageCode && ['ru', 'uk', 'be', 'kk'].includes(languageCode.slice(0, 2)) ? 'ru' : 'en';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(n);

export const T = {
  ru: {
    play: '🎰 Играть',
    open: 'Открыть',
    welcome: (name: string) =>
      `Привет, ${escapeHtml(name)}! 🚗\n\n<b>Номерной Фарт</b> — выбивай случайные номера, собирай блатные серии, торгуй на рынке и попади в топ.\n\nЖми кнопку ниже, чтобы начать.`,
    help:
      'Команды:\n/start — открыть игру\n/paysupport — помощь с оплатой\n\nВ любом чате напиши @{bot} и номер, чтобы поделиться им.',
    paysupport:
      'Если с оплатой что-то пошло не так — напишите сюда номер платежа и что случилось. Попытки начисляются только после подтверждения оплаты Telegram; повторно списаний не бывает.',
    paid: (rolls: number) => `✅ Оплата прошла! Начислено попыток: <b>${rolls}</b>. Удачи на барабане!`,
    paidItem: '✅ Оплата прошла! Покупка уже в игре.',
    refunded: '↩️ Покупку выдать не получилось (например, тираж закончился) — Stars возвращены.',
    preCheckoutError: 'Не удалось проверить платёж. Попробуйте ещё раз.',
    shareCaption: (card: PlateCardDto) =>
      `${TIER_EMOJI[card.plate.tier]} <b>${formatPlate(card.plate)}</b>\n${TIER_NAMES.ru[card.plate.tier]} · ценность ${fmt(card.plate.value)} Фишек`,
    shareTitle: (card: PlateCardDto) => `${formatPlate(card.plate)} — ${TIER_NAMES.ru[card.plate.tier]}`,
    shareNotFound: 'Номер не найден',
    shareHint: 'Введите номер, например А777АА77',
  },
  en: {
    play: '🎰 Play',
    open: 'Open',
    welcome: (name: string) =>
      `Hi, ${escapeHtml(name)}! 🚗\n\n<b>Lucky Plates</b> — roll random license plates, collect rare series, trade on the market and climb the leaderboard.\n\nTap the button below to start.`,
    help: 'Commands:\n/start — open the game\n/paysupport — payment help\n\nType @{bot} and a plate in any chat to share it.',
    paysupport:
      'If something went wrong with a payment, send the payment details here. Rolls are added only after Telegram confirms the payment; you are never charged twice.',
    paid: (rolls: number) => `✅ Payment received! Rolls added: <b>${rolls}</b>. Good luck!`,
    paidItem: '✅ Payment received! Your purchase is in the game.',
    refunded: '↩️ We could not deliver the purchase (e.g. the edition sold out) — your Stars were refunded.',
    preCheckoutError: 'Could not verify the payment. Please try again.',
    shareCaption: (card: PlateCardDto) =>
      `${TIER_EMOJI[card.plate.tier]} <b>${formatPlate(card.plate)}</b>\n${TIER_NAMES.en[card.plate.tier]} · value ${fmt(card.plate.value)} chips`,
    shareTitle: (card: PlateCardDto) => `${formatPlate(card.plate)} — ${TIER_NAMES.en[card.plate.tier]}`,
    shareNotFound: 'Plate not found',
    shareHint: 'Type a plate, e.g. A777AA77',
  },
};

/** Текст уведомления и параметр запуска Mini App для кнопки. */
export function renderNotification(job: NotificationJob): { text: string; startParam?: string } {
  const ru = job.locale !== 'en';
  switch (job.type) {
    case 'free_roll_ready':
      return { text: ru ? '🎰 Бесплатная попытка готова! Заходи выбить номер.' : '🎰 Your free roll is ready!' };
    case 'plate_sold':
      return {
        text: ru
          ? `💰 Ваш номер <b>${escapeHtml(job.plate)}</b> купили на рынке за ${fmt(job.price)} Фишек. Вам начислено ${fmt(job.received)}.`
          : `💰 Your plate <b>${escapeHtml(job.plate)}</b> was sold for ${fmt(job.price)} chips. You received ${fmt(job.received)}.`,
      };
    case 'trade_offer':
      return {
        text: ru
          ? `🔁 ${escapeHtml(job.fromName)} предлагает вам обмен номерами.`
          : `🔁 ${escapeHtml(job.fromName)} offers you a plate trade.`,
        startParam: `trade_${job.code}`,
      };
    case 'trade_accepted':
      return {
        text: ru
          ? `🤝 ${escapeHtml(job.byName)} принял(а) ваше предложение обмена.`
          : `🤝 ${escapeHtml(job.byName)} accepted your trade offer.`,
        startParam: `trade_${job.code}`,
      };
    case 'referral_joined':
      return {
        text: ru
          ? `🎉 ${escapeHtml(job.name)} пришёл(ла) по вашей ссылке! +${fmt(job.reward)} Фишек.`
          : `🎉 ${escapeHtml(job.name)} joined via your link! +${fmt(job.reward)} chips.`,
      };
    case 'car_sold':
      return {
        text: ru
          ? `🚗 Вашу машину <b>${escapeHtml(job.car)}</b> купили за ${fmt(job.price)} Фишек. Вам начислено ${fmt(job.received)}.`
          : `🚗 Your car <b>${escapeHtml(job.car)}</b> was sold for ${fmt(job.price)} chips. You received ${fmt(job.received)}.`,
        startParam: 'cars',
      };
    case 'trip_returned': {
      const event = job.event ? `\n${escapeHtml(ru ? job.event.ru : job.event.en)}` : '';
      return {
        text: ru
          ? `🏁 <b>${escapeHtml(job.car)}</b> вернулась с покатушек: +${fmt(job.income)} Фишек.${event}\nЗабери доход в гараже.`
          : `🏁 <b>${escapeHtml(job.car)}</b> is back from the cruise: +${fmt(job.income)} chips.${event}\nCollect it in the garage.`,
        startParam: 'cars',
      };
    }
    case 'race_finished':
      return {
        text: job.won
          ? ru
            ? `🏆 Вы обогнали ${escapeHtml(job.opponent)} в дрэге!${job.payout ? ` +${fmt(job.payout)} Фишек.` : ''}`
            : `🏆 You beat ${escapeHtml(job.opponent)} in a drag race!${job.payout ? ` +${fmt(job.payout)} chips.` : ''}`
          : ru
            ? `🏁 ${escapeHtml(job.opponent)} оказался быстрее в дрэге. Реванш?`
            : `🏁 ${escapeHtml(job.opponent)} was faster in the drag race. Rematch?`,
        startParam: 'races',
      };
    case 'auction_outbid':
      return {
        text: ru
          ? `⚡ Вашу ставку на <b>${escapeHtml(job.plate)}</b> перебили: ${fmt(job.amount)} Фишек. Ваши Фишки возвращены.`
          : `⚡ You were outbid on <b>${escapeHtml(job.plate)}</b>: ${fmt(job.amount)} chips. Your chips are returned.`,
        startParam: 'auction',
      };
    case 'auction_won':
      return {
        text: ru
          ? `🔨 Номер <b>${escapeHtml(job.plate)}</b> ваш! Победная ставка — ${fmt(job.price)} Фишек.`
          : `🔨 The plate <b>${escapeHtml(job.plate)}</b> is yours! Winning bid: ${fmt(job.price)} chips.`,
      };
    case 'dream_plate':
      return {
        text: ru
          ? `✨ Номер мечты по маске ${escapeHtml(job.mask)}: <b>${escapeHtml(job.plate)}</b> ${job.source === 'auction' ? 'на аукционе' : 'на рынке'} за ${fmt(job.price)} Фишек.`
          : `✨ Dream plate for ${escapeHtml(job.mask)}: <b>${escapeHtml(job.plate)}</b> ${job.source === 'auction' ? 'at the auction' : 'on the market'} for ${fmt(job.price)} chips.`,
        startParam: job.source === 'auction' ? 'auction' : 'market',
      };
    case 'reward': {
      const what = ru
        ? job.reason === 'exhibition' ? 'автовыставке' : 'турнире гонок'
        : job.reason === 'exhibition' ? 'the car show' : 'the race tournament';
      return {
        text: ru
          ? `🥇 ${job.place}-е место на ${what}! Награда: ${fmt(job.chips)} Фишек и ${fmt(job.rolls)} попыток.`
          : `🥇 Place ${job.place} at ${what}! Reward: ${fmt(job.chips)} chips and ${fmt(job.rolls)} rolls.`,
      };
    }
  }
}
