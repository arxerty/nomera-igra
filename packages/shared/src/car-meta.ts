import type { AchievementId } from './achievements';
import type { CarArchetype, CarClass, CarStat, PaintFinish } from './cars';
import type { ComboId } from './combos';
import type { Locale } from './tier-meta';

export const CAR_CLASS_NAMES: Record<Locale, Record<CarClass, string>> = {
  ru: {
    economy: 'Эконом',
    comfort: 'Комфорт',
    business: 'Бизнес',
    premium: 'Премиум',
    luxury: 'Люкс',
    collectible: 'Коллекционная',
  },
  en: {
    economy: 'Economy',
    comfort: 'Comfort',
    business: 'Business',
    premium: 'Premium',
    luxury: 'Luxury',
    collectible: 'Collectible',
  },
};

export const CAR_STAT_NAMES: Record<Locale, Record<CarStat, string>> = {
  ru: { speed: 'Скорость', acceleration: 'Разгон', handling: 'Управляемость', prestige: 'Престиж' },
  en: { speed: 'Top speed', acceleration: 'Acceleration', handling: 'Handling', prestige: 'Prestige' },
};

export const CAR_ARCHETYPE_NAMES: Record<Locale, Record<CarArchetype, string>> = {
  ru: {
    soviet_classic: 'Советская классика',
    people_sedan: 'Народный седан',
    comfort_sedan: 'Комфортный седан',
    crossover: 'Кроссовер',
    business_sedan: 'Бизнес-седан',
    german_crossover: 'Немецкий кроссовер',
    sports_car: 'Спорткар',
    offroad_gelik: 'Внедорожник',
    limousine: 'Лимузин',
  },
  en: {
    soviet_classic: 'Soviet classic',
    people_sedan: "People's sedan",
    comfort_sedan: 'Comfort sedan',
    crossover: 'Crossover',
    business_sedan: 'Business sedan',
    german_crossover: 'German crossover',
    sports_car: 'Sports car',
    offroad_gelik: 'Boxy off-roader',
    limousine: 'Limousine',
  },
};

export const PAINT_FINISH_NAMES: Record<Locale, Record<PaintFinish, string>> = {
  ru: {
    gloss: 'Глянец',
    metallic: 'Металлик',
    pearl: 'Перламутр',
    matte: 'Матовая',
    chameleon: 'Хамелеон',
    exclusive: 'Эксклюзив',
  },
  en: {
    gloss: 'Gloss',
    metallic: 'Metallic',
    pearl: 'Pearl',
    matte: 'Matte',
    chameleon: 'Chameleon',
    exclusive: 'Exclusive',
  },
};

export const COMBO_NAMES: Record<Locale, Record<ComboId, { title: string; hint: string }>> = {
  ru: {
    status: { title: 'Статус', hint: 'Редкость номера соответствует классу машины' },
    style: { title: 'Стиль', hint: 'Цифры номера совпадают с годом или названием модели' },
    series: { title: 'Своя серия', hint: 'Несколько машин с номерами одной буквенной серии' },
    mesalliance: { title: 'Мезальянс', hint: 'Мифический номер на машине эконом-класса' },
  },
  en: {
    status: { title: 'Status', hint: 'Plate rarity matches the car class' },
    style: { title: 'Style', hint: 'Plate digits match the model year or name' },
    series: { title: 'Own series', hint: 'Several cars with plates of the same letter series' },
    mesalliance: { title: 'Mismatch', hint: 'A mythic plate on an economy car' },
  },
};

export const ACHIEVEMENT_NAMES: Record<Locale, Record<AchievementId, { title: string; hint: string }>> = {
  ru: {
    collector: { title: 'Коллекционер', hint: '50 номеров в гараже' },
    car_enthusiast: { title: 'Автолюбитель', hint: '10 машин в гараже' },
    track_king: { title: 'Король трассы', hint: '100 побед в гонках' },
    three_sevens: { title: 'Владелец трёх семёрок', hint: 'Номер с цифрами 777' },
    mesalliance: { title: 'Мезальянс', hint: 'Мифический номер на машине эконом-класса' },
    series_master: { title: 'Хозяин серии', hint: '5 машин с номерами одной буквенной серии' },
    exhibition_star: { title: 'Звезда выставки', hint: 'Топ-10 автовыставки' },
    auction_winner: { title: 'Молоток', hint: 'Выиграл номерной аукцион' },
  },
  en: {
    collector: { title: 'Collector', hint: '50 plates in the garage' },
    car_enthusiast: { title: 'Car enthusiast', hint: '10 cars in the garage' },
    track_king: { title: 'King of the track', hint: '100 race wins' },
    three_sevens: { title: 'Triple seven owner', hint: 'A plate with 777' },
    mesalliance: { title: 'Mismatch', hint: 'A mythic plate on an economy car' },
    series_master: { title: 'Series master', hint: '5 cars with plates of one letter series' },
    exhibition_star: { title: 'Show star', hint: 'Top 10 at the car show' },
    auction_winner: { title: 'Gavel', hint: 'Won a plate auction' },
  },
};
