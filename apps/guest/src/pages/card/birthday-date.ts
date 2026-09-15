/**
 * Дата рождения, которую гость вводит один раз. docs/02, раздел 2.7 · docs/11, У9.
 *
 * Та же проверка, что на сервере (`GuestBirthdayInput`): настоящая дата `YYYY-MM-DD`,
 * не раньше 1900 года и не из будущего. Здесь она нужна, чтобы кнопка не отправляла
 * заведомо негодное: изменить дату потом нельзя, и ошибка сервера после подтверждения
 * выглядела бы как поломка.
 */

export type BirthdayProblem = 'empty' | 'format' | 'range'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Сегодня по часам телефона гостя — граница «не из будущего» для поля ввода. */
export const todayIso = (now: Date): string =>
  [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

export const birthdayProblem = (value: string, today: string): BirthdayProblem | null => {
  const trimmed = value.trim()

  if (trimmed === '') {
    return 'empty'
  }

  // 30 февраля Date молча превращает в 2 марта — такая дата не настоящая.
  if (
    !ISO_DATE.test(trimmed) ||
    new Date(`${trimmed}T00:00:00Z`).toISOString().slice(0, 10) !== trimmed
  ) {
    return 'format'
  }

  return trimmed < '1900-01-01' || trimmed > today ? 'range' : null
}

/** «17.09.1990» — день впереди, как принято и в Таиланде, и в России. */
export const formatBirthday = (value: string): string => {
  const [year, month, day] = value.split('-')
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`
}
