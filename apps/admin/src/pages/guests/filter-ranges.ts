/**
 * Диапазоны «от и до» в выпадающем списке фильтров гостей. docs/02, раздел 5.2.
 *
 * Сервер принимает любые границы, а экран предлагает готовые: «5 и больше»
 * владелец выбирает быстрее, чем печатает два числа. Значение пункта списка —
 * обе границы одной строкой, «5:» или «2:4»: так один `<select>` держит пару
 * полей и не разваливается на два.
 *
 * Пересланная ссылка может принести границы, которых нет среди готовых, —
 * «от 3 до 7». Такой диапазон показывается отдельным пунктом, а не молча «Все»:
 * иначе экран врал бы, что фильтра нет.
 */

export interface Range {
  readonly from: number | undefined
  readonly to: number | undefined
}

/** Пусто — фильтр снят. */
export const encodeRange = (range: Range): string =>
  range.from === undefined && range.to === undefined
    ? ''
    : `${range.from === undefined ? '' : String(range.from)}:${range.to === undefined ? '' : String(range.to)}`

/** Из значения пункта обратно в границы. Незнакомое — фильтр снят. */
export const decodeRange = (value: string): Range => {
  const match = /^(\d*):(\d*)$/.exec(value)

  if (match === null) {
    return { from: undefined, to: undefined }
  }

  const bound = (raw: string | undefined): number | undefined =>
    raw === undefined || raw === '' ? undefined : Number(raw)

  return { from: bound(match[1]), to: bound(match[2]) }
}

/** Покупок: одна, несколько, постоянные, самые частые. */
export const VISIT_RANGES: readonly Range[] = [
  { from: 1, to: 1 },
  { from: 2, to: 4 },
  { from: 5, to: undefined },
  { from: 10, to: undefined },
]

/** Баллы на карте, в сатангах: нет, есть, от 100, 500 и 1 000 ฿. */
export const POINT_RANGES: readonly Range[] = [
  { from: undefined, to: 0 },
  { from: 1, to: undefined },
  { from: 10_000, to: undefined },
  { from: 50_000, to: undefined },
  { from: 100_000, to: undefined },
]

/** Потратил за всё время, в сатангах: от 1 000, 5 000, 10 000 и 50 000 ฿. */
export const SPENT_FROM: readonly number[] = [100_000, 500_000, 1_000_000, 5_000_000]
