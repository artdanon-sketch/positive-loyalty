/**
 * Вывод скриптов: форматирование денег и таблицы для терминала.
 *
 * Отдельный модуль по двум причинам. Первая — железное правило 4 (CLAUDE.md): деньги
 * хранятся и считаются целыми в минорных единицах, а превращаются в «690,00 ฿» только
 * на выводе. Пока эта функция одна и живёт в одном месте, соблазна поделить на сто
 * где-нибудь в бизнес-логике не возникает.
 *
 * Вторая — вывод seed и вывод демо-продаж смотрит один и тот же человек, и таблицы у
 * них должны быть одинаковые.
 *
 * `console.log` не используем: он запрещён (CLAUDE.md) и в скрипте не нужен — пишем
 * прямо в stdout.
 */

/** Сколько минорных единиц в одной мажорной. Для THB — сатанги. */
const MINOR_UNITS_PER_MAJOR = 100

/** Неразрывный пробел: разряды числа не должны переноситься по строке. */
const GROUP_SEPARATOR = '\u00A0'

/** Печатает строку в stdout. Единственное место в скриптах, которое это делает. */
export const out = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}

/** Разбивает целую часть на разряды по три: 1234567 → «1 234 567». */
const groupDigits = (value: number): string => {
  const digits = String(value)
  const parts: string[] = []

  for (let end = digits.length; end > 0; end -= 3) {
    parts.unshift(digits.slice(Math.max(0, end - 3), end))
  }

  return parts.join(GROUP_SEPARATOR)
}

/**
 * Минорные единицы → человекочитаемая сумма: 69000 → «690,00 ฿».
 *
 * Никакого Intl.NumberFormat: его вывод зависит от версии ICU в конкретной сборке node,
 * а скриншоты демо не должны плыть между машинами.
 *
 * Знак «−» здесь типографский минус, а не дефис: в таблице он выравнивается по ширине
 * с цифрами и не путается с переносом.
 */
export const formatMinorUnits = (minor: number, symbol = '฿'): string => {
  const sign = minor < 0 ? '−' : ''
  const absolute = Math.abs(minor)
  const major = Math.trunc(absolute / MINOR_UNITS_PER_MAJOR)
  const fraction = absolute % MINOR_UNITS_PER_MAJOR

  return `${sign}${groupDigits(major)},${String(fraction).padStart(2, '0')} ${symbol}`
}

/** Со знаком «+» у положительных: в журнале важно видеть направление операции. */
export const formatSignedMinorUnits = (minor: number, symbol = '฿'): string =>
  minor > 0 ? `+${formatMinorUnits(minor, symbol)}` : formatMinorUnits(minor, symbol)

/** Время операции в локальном виде без миллисекунд: «25.08.2026 14:03:11». */
export const formatMoment = (value: Date): string => {
  const pad = (part: number): string => String(part).padStart(2, '0')

  return (
    `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  )
}

export interface TableColumn {
  readonly title: string
  readonly align: 'left' | 'right'
}

const BORDER = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  topTee: '┬',
  bottomTee: '┴',
  leftTee: '├',
  rightTee: '┤',
  cross: '┼',
} as const

const cellWidths = (
  columns: readonly TableColumn[],
  rows: readonly (readonly string[])[],
): number[] =>
  columns.map((column, index) =>
    rows.reduce((width, row) => Math.max(width, (row[index] ?? '').length), column.title.length),
  )

const padCell = (value: string, width: number, align: 'left' | 'right'): string =>
  align === 'right' ? value.padStart(width) : value.padEnd(width)

const rule = (widths: readonly number[], left: string, tee: string, right: string): string =>
  left + widths.map((width) => BORDER.horizontal.repeat(width + 2)).join(tee) + right

/**
 * Рисует таблицу рамкой из псевдографики.
 *
 * Ширина считается по длине строки в кодовых единицах — этого достаточно: и кириллица,
 * и «฿» занимают по одной позиции. Эмодзи в таблицах не используем.
 */
export const renderTable = (
  columns: readonly TableColumn[],
  rows: readonly (readonly string[])[],
): string => {
  const widths = cellWidths(columns, rows)

  const renderRow = (cells: readonly string[]): string =>
    BORDER.vertical +
    widths
      .map(
        (width, index) =>
          ` ${padCell(cells[index] ?? '', width, columns[index]?.align ?? 'left')} `,
      )
      .join(BORDER.vertical) +
    BORDER.vertical

  return [
    rule(widths, BORDER.topLeft, BORDER.topTee, BORDER.topRight),
    renderRow(columns.map((column) => column.title)),
    rule(widths, BORDER.leftTee, BORDER.cross, BORDER.rightTee),
    ...rows.map(renderRow),
    rule(widths, BORDER.bottomLeft, BORDER.bottomTee, BORDER.bottomRight),
  ].join('\n')
}

/** Заголовок раздела: пустая строка, текст, подчёркивание. */
export const heading = (text: string): string => `\n${text}\n${'─'.repeat(text.length)}`
