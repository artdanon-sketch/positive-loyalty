import type { RfmSegment } from '@positive/contracts'

/**
 * RFM-сегмент гостя. docs/02, раздел 5.10 · docs/11, У8.
 *
 * ПОРОГИ, А НЕ КВАНТИЛИ. Классический RFM делит гостей на пятые доли, и в кафе,
 * где все были по разу, каждый оказывается «чемпионом». Пороги в днях и визитах
 * одинаковы для любого заведения и объясняются одной фразой: «чемпионы — были
 * за последний месяц и приходили пять раз и больше».
 *
 * Денежная часть (M) в выборе сегмента не участвует: у малого заведения чек
 * почти не различается, а частота и давность говорят о лояльности точнее.
 * Оборот сегмента всё равно показывается в отчёте.
 *
 * Сегменты — по сетке «давность × частота», первая строка — самые частые.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Давность: 5 — были на этой неделе-двух, 1 — не были дольше четырёх месяцев. */
export const recencyScore = (daysSinceLastVisit: number): number => {
  if (daysSinceLastVisit <= 14) return 5
  if (daysSinceLastVisit <= 30) return 4
  if (daysSinceLastVisit <= 60) return 3
  if (daysSinceLastVisit <= 120) return 2
  return 1
}

/** Частота: 1 — одна покупка, 5 — десять и больше. */
export const frequencyScore = (visits: number): number => {
  if (visits >= 10) return 5
  if (visits >= 5) return 4
  if (visits >= 3) return 3
  if (visits === 2) return 2
  return 1
}

/** GRID[5 − частота][давность − 1]. */
const GRID: ReadonlyArray<readonly RfmSegment[]> = [
  // частота 5
  ['CANT_LOSE', 'AT_RISK', 'LOYAL', 'CHAMPIONS', 'CHAMPIONS'],
  // частота 4
  ['CANT_LOSE', 'AT_RISK', 'LOYAL', 'LOYAL', 'CHAMPIONS'],
  // частота 3
  ['AT_RISK', 'AT_RISK', 'NEED_ATTENTION', 'LOYAL', 'LOYAL'],
  // частота 2
  ['HIBERNATING', 'ABOUT_TO_SLEEP', 'ABOUT_TO_SLEEP', 'POTENTIAL', 'POTENTIAL'],
  // частота 1
  ['HIBERNATING', 'HIBERNATING', 'PROMISING', 'NEW', 'NEW'],
]

export const rfmSegment = (recency: number, frequency: number): RfmSegment => {
  const row = GRID[5 - frequency]
  const segment = row?.[recency - 1]

  if (segment === undefined) {
    throw new RangeError(
      `RFM-оценки вне 1…5: давность ${String(recency)}, частота ${String(frequency)}`,
    )
  }

  return segment
}

/** Сегмент покупателя на момент `now`. Гостей без покупок в сегментах нет. */
export const segmentOf = (
  guest: { readonly lastVisitAt: Date; readonly visitsTotal: number },
  now: Date,
): RfmSegment => {
  const days = Math.max(0, Math.floor((now.getTime() - guest.lastVisitAt.getTime()) / DAY_MS))

  return rfmSegment(recencyScore(days), frequencyScore(guest.visitsTotal))
}
