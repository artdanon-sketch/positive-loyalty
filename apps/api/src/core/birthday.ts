/**
 * Попадает ли сегодняшний день в окно дня рождения. docs/11, У9.
 *
 * Возвращает ГОД того дня рождения, в чьё окно попал сегодняшний день, или null.
 * Год — часть ключа подарка: один подарок на один день рождения.
 *
 * ОКНО ПЕРЕХОДИТ ЧЕРЕЗ НОВЫЙ ГОД. День рождения 30 декабря и окно «три дня после»
 * — это и 2 января следующего года, и подарок в этот день — за прошлый год, а не
 * за будущий. Поэтому проверяются три соседних года.
 *
 * 29 ФЕВРАЛЯ в невисокосный год празднуется 28-го: гость без дня рождения
 * три года из четырёх — не то, что обещала программа.
 *
 * `today` — полночь UTC местного дня заведения (common/time/local-day.ts).
 */

const DAY_MS = 24 * 60 * 60 * 1000

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

export const birthdayYearInWindow = (
  birthday: Date,
  today: Date,
  daysBefore: number,
  daysAfter: number,
): number | null => {
  const month = birthday.getUTCMonth()
  const day = birthday.getUTCDate()
  const year = today.getUTCFullYear()

  for (const candidate of [year - 1, year, year + 1]) {
    const celebrated = month === 1 && day === 29 && !isLeap(candidate) ? 28 : day
    const occurrence = Date.UTC(candidate, month, celebrated)
    const diff = Math.round((today.getTime() - occurrence) / DAY_MS)

    if (diff >= -daysBefore && diff <= daysAfter) {
      return candidate
    }
  }

  return null
}

/**
 * День рождения в окне фильтра гостей: сегодня, в ближайшие семь дней или в этом
 * месяце. docs/02, раздел 5.2.
 *
 * «Неделя» — сегодня и шесть дней вперёд, через Новый год тоже: в пятницу
 * 29 декабря именинник 2 января — на этой неделе. Правила те же, что у подарка:
 * 29 февраля в невисокосный год — 28-го.
 *
 * «Месяц» — календарный месяц заведения: 29 февраля попадает в февраль всегда.
 */
export const birthdayInWindow = (
  birthday: Date,
  today: Date,
  window: 'today' | 'week' | 'month',
): boolean => {
  if (window === 'month') {
    return birthday.getUTCMonth() === today.getUTCMonth()
  }

  return birthdayYearInWindow(birthday, today, window === 'week' ? 6 : 0, 0) !== null
}
