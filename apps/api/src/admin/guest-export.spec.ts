import { describe, expect, it } from 'vitest'

import { csvCell, guestsCsv } from './guest-export'
import type { ExportRow } from './guest-export'

const ANNA: ExportRow = {
  name: 'Анна Ковалёва',
  phone: '+66 •• •• 4821',
  mode: 'RESIDENT',
  tier: 'Золото',
  source: 'ORGANIC',
  points: 30_175,
  visits: 4,
  spent: 603_500,
  since: new Date('2026-08-20T12:00:00.000Z'),
  lastVisit: new Date('2026-09-14T18:30:00.000Z'),
}

describe('Выгрузка гостей в CSV', () => {
  it('ЗАГОЛОВОК И СТРОКА: СУММЫ В БАТАХ С ТОЧКОЙ, ДАТЫ ПО ЧАСАМ ЗАВЕДЕНИЯ, BOM ДЛЯ EXCEL', () => {
    const csv = guestsCsv([ANNA], { locale: 'ru', timezone: 'Asia/Bangkok' })

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Имя,Телефон,Турист или резидент,Статус,Источник,"Баллы, ฿",Визиты,"Оборот, ฿",В программе с,Последний визит',
      // 18:30 UTC 14 сентября — это уже 15 сентября на Пхукете.
      // Телефон с апострофом: иначе Excel прочитал бы «+66» как начало формулы.
      "Анна Ковалёва,'+66 •• •• 4821,резидент,Золото,пришёл сам,301.75,4,6035.00,2026-08-20,2026-09-15",
      '',
    ])
  })

  it('ФОРМУЛА В ИМЕНИ НЕ ИСПОЛНИТСЯ В EXCEL: АПОСТРОФ ВПЕРЕДИ', () => {
    expect(csvCell('=HYPERLINK("http://x","клик")')).toBe('"\'=HYPERLINK(""http://x"",""клик"")"')
    expect(csvCell('+66 1234')).toBe("'+66 1234")
    expect(csvCell('@admin')).toBe("'@admin")
    expect(csvCell('-5')).toBe("'-5")
  })

  it('кавычки, запятые и переводы строк — по RFC 4180; пустое — пустая ячейка', () => {
    expect(csvCell('Анна "Кофе", Ката')).toBe('"Анна ""Кофе"", Ката"')
    expect(csvCell('две\nстроки')).toBe('"две\nстроки"')
    expect(csvCell(null)).toBe('')
  })

  it('без имени, телефона и статуса — пустые ячейки; язык заголовков — по выбору', () => {
    const csv = guestsCsv(
      [{ ...ANNA, name: null, phone: null, tier: null, since: null, lastVisit: null }],
      { locale: 'en', timezone: 'Asia/Bangkok' },
    )

    expect(csv.slice(1).split('\r\n')[1]).toBe(',,resident,,came on their own,301.75,4,6035.00,,')
    expect(csv).toContain('Member since')
  })
})
