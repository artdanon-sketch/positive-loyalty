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
