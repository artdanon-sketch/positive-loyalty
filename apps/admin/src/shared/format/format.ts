/**
 * Форматирование вывода. Хранение и расчёты — целые в минорных единицах
 * (CLAUDE.md, железное правило 4); в человеческий вид суммы переводятся
 * только здесь, на самом выходе.
 *
 * Локаль фиксирована на ru-RU намеренно: денежные колонки должны выглядеть
 * одинаково при любом языке интерфейса, иначе таблица «прыгает» при смене
 * языка. Отвяжем от языка вместе с th/zh (docs/04, раздел 3).
 */

const bahtFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 69000 → «690,00 ฿» */
export function formatBaht(minor: number): string {
  return `${bahtFormat.format(minor / 100)} ฿`
}

/** Знаковая сумма для журнала: +34,50 ฿ / −22,75 ฿. Минус типографский. */
export function formatSignedBaht(minor: number): string {
  if (minor > 0) {
    return `+${formatBaht(minor)}`
  }
  if (minor < 0) {
    return `−${formatBaht(-minor)}`
  }
  return formatBaht(0)
}

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** ISO-строка → «26.08, 14:31». Битую дату показываем прочерком, не падаем. */
export function formatDateTime(iso: string | null): string {
  if (iso === null) {
    return '—'
  }

  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date)
}
