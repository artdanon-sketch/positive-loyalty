/**
 * Сколько баллов сгорает. docs/02, раздел 5.6.8.
 *
 * ЧИСТАЯ ФУНКЦИЯ БЕЗ БАЗЫ, потому что это арифметика чужих денег: ошибка здесь
 * сжигает баллы, которые гость заработал вчера, и заметит он это у стойки.
 *
 * ПРАВИЛО FIFO: списания гасят самые старые начисления. Иначе гость, который
 * копил год и на прошлой неделе потратил половину, увидел бы, что «сгорело»
 * ровно то, что он уже потратил.
 *
 * Считается так: всё, что начислено раньше рубежа, минус всё, что когда-либо
 * списано. Что осталось — то и просрочено. Больше текущего остатка сгореть
 * не может: между расчётом и записью гость мог расплатиться баллами.
 */

export interface ExpiryFacts {
  /** Сумма начислений, сделанных раньше рубежа (только положительные записи). */
  readonly earnedBeforeCutoff: number
  /** Сумма всех списаний за всё время, положительным числом. */
  readonly spentTotal: number
  /** Текущий остаток на участии. */
  readonly balance: number
}

export const expiringPoints = (facts: ExpiryFacts): number => {
  const stale = facts.earnedBeforeCutoff - facts.spentTotal

  if (stale <= 0) {
    return 0
  }

  return Math.min(stale, Math.max(0, facts.balance))
}

/**
 * Рубеж: всё, что начислено раньше него, считается просроченным.
 *
 * Считается от начала суток заведения, а не от «ровно N×24 часа назад»: гость
 * не должен терять баллы в середине дня, в который он, может быть, как раз
 * собрался зайти.
 */
export const expiryCutoff = (now: Date, days: number): Date => {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000)
}

/** Ключ идемпотентности: одно сгорание на участие в сутки. */
export const expiryKey = (membershipId: string, now: Date): string =>
  `expire:${membershipId}:${now.toISOString().slice(0, 10)}`

/**
 * Что сгорит в ближайшее время и когда. docs/02, раздел 2.1.
 *
 * ГОСТЬ ДОЛЖЕН УЗНАТЬ ЗАРАНЕЕ, А НЕ ПОСТФАКТУМ. Сгоревшие молча баллы — это
 * не экономия заведения, а обиженный человек у стойки: он копил и не знал,
 * что у накоплений есть срок.
 *
 * СЧИТАЕМ ПО ТОМУ ЖЕ ПРАВИЛУ FIFO, что и само сгорание: списания гасят самые
 * старые начисления. Иначе предупреждение разойдётся с тем, что произойдёт,
 * и это хуже молчания.
 *
 * ПОКАЗЫВАЕМ ТОЛЬКО БЛИЖАЙШУЮ ПАРТИЮ. «Сгорит 120 баллов 3 октября» — это
 * повод зайти; полный график сгорания на год вперёд — это таблица, которую
 * никто не читает.
 */

export interface EarnBatch {
  /** Когда начислено. */
  readonly at: Date
  /** Сколько начислено. */
  readonly amount: number
}

export interface UpcomingExpiry {
  readonly points: number
  readonly at: Date
}

export const upcomingExpiry = (
  earns: readonly EarnBatch[],
  spentTotal: number,
  days: number,
  now: Date,
): UpcomingExpiry | null => {
  let left = spentTotal
  const cutoff = expiryCutoff(now, days)
  // Самые старые — первыми, как бы ни пришли: запрос сортирует по дате записи,
  // а чек из кассы POSitive старится по дате операции. Без этого предупреждение
  // гасило списаниями не те партии и называло не ту дату.
  const oldestFirst = [...earns].sort((a, b) => a.at.getTime() - b.at.getTime())

  for (const earn of oldestFirst) {
    // Списания гасят самые старые начисления: пока хватает потраченного,
    // партия уже погашена и сгорать в ней нечему.
    if (left >= earn.amount) {
      left -= earn.amount
      continue
    }

    const rest = earn.amount - left
    const at = new Date(earn.at.getTime() + days * 24 * 60 * 60 * 1000)

    // Партия, уже перешедшая рубеж, сгорит ближайшим проходом — сегодня.
    return { points: rest, at: earn.at < cutoff ? now : at }
  }

  return null
}
