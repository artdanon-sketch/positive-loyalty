/**
 * Выгрузка гостей в CSV. docs/02, раздел 5.2 · docs/11, У4.
 *
 * ТЕЛЕФОНЫ — ТОЛЬКО МАСКОЙ, ДАЖЕ ВЛАДЕЛЬЦУ. Файл уходит с экрана: в почту,
 * в мессенджер, на флешку бухгалтеру. Полный номер в нём — это база, которая
 * утекает одним пересланным файлом. Сюда приходит уже маска: полного номера
 * этот модуль не видит вовсе.
 *
 * ФОРМУЛЫ В ЯЧЕЙКАХ ОБЕЗВРЕЖЕНЫ. Имя гостя «=HYPERLINK(…)» в Excel стало бы
 * ссылкой, а то и командой: текст, начинающийся с = + - @ или табуляции,
 * получает апостроф.
 *
 * BOM В НАЧАЛЕ: без него Excel открывает UTF-8 кракозябрами. Разделитель —
 * запятая, кавычки — по RFC 4180, суммы — с точкой, даты — по часам заведения.
 */

export type ExportLocale = 'ru' | 'en'

export interface ExportRow {
  readonly name: string | null
  /** Уже маска. */
  readonly phone: string | null
  readonly mode: 'TOURIST' | 'RESIDENT'
  readonly tier: string | null
  readonly source: 'ORGANIC' | 'CATALOG' | 'REFERRAL' | 'STAFF' | 'IMPORT'
  /** Минорные единицы. */
  readonly points: number
  readonly visits: number
  /** Минорные единицы. */
  readonly spent: number
  readonly since: Date | null
  readonly lastVisit: Date | null
}

const HEADER: Readonly<Record<ExportLocale, readonly string[]>> = {
  ru: [
    'Имя',
    'Телефон',
    'Турист или резидент',
    'Статус',
    'Источник',
    'Баллы, ฿',
    'Визиты',
    'Оборот, ฿',
    'В программе с',
    'Последний визит',
  ],
  en: [
    'Name',
    'Phone',
    'Tourist or resident',
    'Tier',
    'Source',
    'Points, ฿',
    'Visits',
    'Spent, ฿',
    'Member since',
    'Last visit',
  ],
}

const MODE: Readonly<Record<ExportLocale, Record<ExportRow['mode'], string>>> = {
  ru: { TOURIST: 'турист', RESIDENT: 'резидент' },
  en: { TOURIST: 'tourist', RESIDENT: 'resident' },
}

const SOURCE: Readonly<Record<ExportLocale, Record<ExportRow['source'], string>>> = {
  ru: {
    ORGANIC: 'пришёл сам',
    CATALOG: 'из каталога',
    REFERRAL: 'по приглашению',
    STAFF: 'добавил сотрудник',
    IMPORT: 'из старой базы',
  },
  en: {
    ORGANIC: 'came on their own',
    CATALOG: 'from the catalog',
    REFERRAL: 'referred',
    STAFF: 'added by staff',
    IMPORT: 'imported',
  },
}

const DANGEROUS_START = /^[=+\-@\t\r]/

/** Ячейка CSV: формулы обезврежены, кавычки и переводы строк — по RFC 4180. */
export const csvCell = (value: string | null): string => {
  if (value === null) {
    return ''
  }

  const safe = DANGEROUS_START.test(value) ? `'${value}` : value

  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const baht = (minor: number): string => (minor / 100).toFixed(2)

export const guestsCsv = (
  rows: readonly ExportRow[],
  options: { readonly locale: ExportLocale; readonly timezone: string },
): string => {
  const day = (value: Date | null): string | null => {
    if (value === null) {
      return null
    }

    const format = (zone: string): string =>
      // en-CA пишет дату как ГГГГ-ММ-ДД — так её одинаково понимают все таблицы.
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(value)

    try {
      return format(options.timezone)
    } catch {
      return format('Asia/Bangkok')
    }
  }

  const lines = [
    HEADER[options.locale].map((title) => csvCell(title)).join(','),
    ...rows.map((row) =>
      [
        row.name,
        row.phone,
        MODE[options.locale][row.mode],
        row.tier,
        SOURCE[options.locale][row.source],
        baht(row.points),
        String(row.visits),
        baht(row.spent),
        day(row.since),
        day(row.lastVisit),
      ]
        .map((cell) => csvCell(cell))
        .join(','),
    ),
  ]

  return `\uFEFF${lines.join('\r\n')}\r\n`
}
