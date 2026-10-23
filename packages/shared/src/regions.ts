/**
 * Коды регионов на номерных знаках РФ (по данным ГИБДД).
 * Это лишь значения по умолчанию: активный список регионов для выдачи
 * хранится в конфиге игры и правится через админ-API.
 */

export interface RegionInfo {
  code: string;
  name: { ru: string; en: string };
}

type RegionGroup = [codes: string[], ru: string, en: string];

const GROUPS: RegionGroup[] = [
  [['01'], 'Республика Адыгея', 'Adygea'],
  [['02', '102', '702'], 'Республика Башкортостан', 'Bashkortostan'],
  [['03'], 'Республика Бурятия', 'Buryatia'],
  [['04'], 'Республика Алтай', 'Altai Republic'],
  [['05'], 'Республика Дагестан', 'Dagestan'],
  [['06'], 'Республика Ингушетия', 'Ingushetia'],
  [['07'], 'Кабардино-Балкарская Республика', 'Kabardino-Balkaria'],
  [['08'], 'Республика Калмыкия', 'Kalmykia'],
  [['09'], 'Карачаево-Черкесская Республика', 'Karachay-Cherkessia'],
  [['10'], 'Республика Карелия', 'Karelia'],
  [['11'], 'Республика Коми', 'Komi'],
  [['12'], 'Республика Марий Эл', 'Mari El'],
  [['13'], 'Республика Мордовия', 'Mordovia'],
  [['14'], 'Республика Саха (Якутия)', 'Sakha (Yakutia)'],
  [['15'], 'Республика Северная Осетия — Алания', 'North Ossetia–Alania'],
  [['16', '116', '716'], 'Республика Татарстан', 'Tatarstan'],
  [['17'], 'Республика Тыва', 'Tuva'],
  [['18'], 'Удмуртская Республика', 'Udmurtia'],
  [['19'], 'Республика Хакасия', 'Khakassia'],
  [['21', '121'], 'Чувашская Республика', 'Chuvashia'],
  [['22'], 'Алтайский край', 'Altai Krai'],
  [['23', '93', '123', '193'], 'Краснодарский край', 'Krasnodar Krai'],
  [['24', '124'], 'Красноярский край', 'Krasnoyarsk Krai'],
  [['25', '125'], 'Приморский край', 'Primorsky Krai'],
  [['26', '126'], 'Ставропольский край', 'Stavropol Krai'],
  [['27'], 'Хабаровский край', 'Khabarovsk Krai'],
  [['28'], 'Амурская область', 'Amur Oblast'],
  [['29'], 'Архангельская область', 'Arkhangelsk Oblast'],
  [['30'], 'Астраханская область', 'Astrakhan Oblast'],
  [['31'], 'Белгородская область', 'Belgorod Oblast'],
  [['32'], 'Брянская область', 'Bryansk Oblast'],
  [['33'], 'Владимирская область', 'Vladimir Oblast'],
  [['34', '134'], 'Волгоградская область', 'Volgograd Oblast'],
  [['35'], 'Вологодская область', 'Vologda Oblast'],
  [['36', '136'], 'Воронежская область', 'Voronezh Oblast'],
  [['37'], 'Ивановская область', 'Ivanovo Oblast'],
  [['38', '138'], 'Иркутская область', 'Irkutsk Oblast'],
  [['39', '91'], 'Калининградская область', 'Kaliningrad Oblast'],
  [['40'], 'Калужская область', 'Kaluga Oblast'],
  [['41'], 'Камчатский край', 'Kamchatka Krai'],
  [['42', '142'], 'Кемеровская область', 'Kemerovo Oblast'],
  [['43'], 'Кировская область', 'Kirov Oblast'],
  [['44'], 'Костромская область', 'Kostroma Oblast'],
  [['45'], 'Курганская область', 'Kurgan Oblast'],
  [['46'], 'Курская область', 'Kursk Oblast'],
  [['47', '147'], 'Ленинградская область', 'Leningrad Oblast'],
  [['48'], 'Липецкая область', 'Lipetsk Oblast'],
  [['49'], 'Магаданская область', 'Magadan Oblast'],
  [['50', '90', '150', '190', '750', '790'], 'Московская область', 'Moscow Oblast'],
  [['51'], 'Мурманская область', 'Murmansk Oblast'],
  [['52', '152'], 'Нижегородская область', 'Nizhny Novgorod Oblast'],
  [['53'], 'Новгородская область', 'Novgorod Oblast'],
  [['54', '154'], 'Новосибирская область', 'Novosibirsk Oblast'],
  [['55'], 'Омская область', 'Omsk Oblast'],
  [['56', '156'], 'Оренбургская область', 'Orenburg Oblast'],
  [['57'], 'Орловская область', 'Oryol Oblast'],
  [['58'], 'Пензенская область', 'Penza Oblast'],
  [['59', '159'], 'Пермский край', 'Perm Krai'],
  [['60'], 'Псковская область', 'Pskov Oblast'],
  [['61', '161', '761'], 'Ростовская область', 'Rostov Oblast'],
  [['62'], 'Рязанская область', 'Ryazan Oblast'],
  [['63', '163', '763'], 'Самарская область', 'Samara Oblast'],
  [['64', '164'], 'Саратовская область', 'Saratov Oblast'],
  [['65'], 'Сахалинская область', 'Sakhalin Oblast'],
  [['66', '96', '196'], 'Свердловская область', 'Sverdlovsk Oblast'],
  [['67'], 'Смоленская область', 'Smolensk Oblast'],
  [['68'], 'Тамбовская область', 'Tambov Oblast'],
  [['69'], 'Тверская область', 'Tver Oblast'],
  [['70'], 'Томская область', 'Tomsk Oblast'],
  [['71'], 'Тульская область', 'Tula Oblast'],
  [['72'], 'Тюменская область', 'Tyumen Oblast'],
  [['73', '173'], 'Ульяновская область', 'Ulyanovsk Oblast'],
  [['74', '174', '774'], 'Челябинская область', 'Chelyabinsk Oblast'],
  [['75'], 'Забайкальский край', 'Zabaykalsky Krai'],
  [['76'], 'Ярославская область', 'Yaroslavl Oblast'],
  [['77', '97', '99', '177', '197', '199', '777', '797', '799', '977'], 'Москва', 'Moscow'],
  [['78', '98', '178', '198'], 'Санкт-Петербург', 'Saint Petersburg'],
  [['79'], 'Еврейская автономная область', 'Jewish Autonomous Oblast'],
  [['83'], 'Ненецкий автономный округ', 'Nenets Autonomous Okrug'],
  [['86', '186'], 'Ханты-Мансийский автономный округ — Югра', 'Khanty-Mansi Autonomous Okrug'],
  [['87'], 'Чукотский автономный округ', 'Chukotka Autonomous Okrug'],
  [['89'], 'Ямало-Ненецкий автономный округ', 'Yamalo-Nenets Autonomous Okrug'],
  [['94'], 'Байконур', 'Baikonur'],
  [['95'], 'Чеченская Республика', 'Chechnya'],
];

export const REGIONS: readonly RegionInfo[] = GROUPS.flatMap(([codes, ru, en]) =>
  codes.map((code) => ({ code, name: { ru, en } })),
).sort((a, b) => Number(a.code) - Number(b.code));

const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

export function getRegion(code: string): RegionInfo | undefined {
  return REGION_BY_CODE.get(code);
}

export const DEFAULT_REGION_CODES: readonly string[] = REGIONS.map((r) => r.code);

/** «Столичные» регионы для мифических номеров: Москва и Санкт-Петербург. */
export const DEFAULT_CAPITAL_REGIONS: readonly string[] = [
  '77', '97', '99', '177', '197', '199', '777', '797', '799', '977',
  '78', '98', '178', '198',
];
