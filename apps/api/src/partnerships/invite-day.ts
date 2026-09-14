/**
 * Сегодняшняя дата в часах заведения — ключ суточной квоты приглашений.
 *
 * Возвращается полночью UTC: так дату хранит колонка типа date, и так её
 * одинаково прочитает любой часовой пояс сервера.
 *
 * ПОЛНОЧЬ ЗАВЕДЕНИЯ, А НЕ СЕРВЕРА. Сервер живёт по UTC, Пхукет — на семь часов
 * впереди. Считай мы по серверу, квота владельца обнулялась бы в семь утра,
 * а приглашение, отправленное в час ночи, списывалось бы со вчерашнего дня.
 */
export const localDay = (timezone: string, now: Date): Date => {
  const format = (zone: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)

  let day: string
  try {
    day = format(timezone)
  } catch {
    // Битая таймзона в данных не должна ронять приглашение — считаем по Бангкоку,
    // в чьём поясе живут все заведения сети.
    day = format('Asia/Bangkok')
  }

  return new Date(`${day}T00:00:00.000Z`)
}
