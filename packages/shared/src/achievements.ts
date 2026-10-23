export const ACHIEVEMENT_IDS = [
  'collector',
  'car_enthusiast',
  'track_king',
  'three_sevens',
  'mesalliance',
  'series_master',
  'exhibition_star',
  'auction_winner',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Сводка игрока, по которой сервер выдаёт ачивки. */
export interface AchievementStats {
  platesOwned: number;
  carsOwned: number;
  raceWins: number;
  /** Есть номер с цифрами 777. */
  ownsTripleSeven: boolean;
  /** Хоть раз собирал комбо «Мезальянс». */
  hadMesalliance: boolean;
  /** Самая большая серия номеров одной буквенной серии на машинах. */
  maxSeries: number;
  exhibitionTop10: number;
  auctionsWon: number;
}

export const ACHIEVEMENT_RULES: Record<AchievementId, (s: AchievementStats) => boolean> = {
  collector: (s) => s.platesOwned >= 50,
  car_enthusiast: (s) => s.carsOwned >= 10,
  track_king: (s) => s.raceWins >= 100,
  three_sevens: (s) => s.ownsTripleSeven,
  mesalliance: (s) => s.hadMesalliance,
  series_master: (s) => s.maxSeries >= 5,
  exhibition_star: (s) => s.exhibitionTop10 >= 1,
  auction_winner: (s) => s.auctionsWon >= 1,
};

export function earnedAchievements(stats: AchievementStats): AchievementId[] {
  return ACHIEVEMENT_IDS.filter((id) => ACHIEVEMENT_RULES[id](stats));
}
