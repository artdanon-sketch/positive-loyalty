import { describe, expect, it } from 'vitest'

import { birthdayInWindow, birthdayYearInWindow } from './birthday'

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)

describe('Окно дня рождения', () => {
  it('ДЕНЬ РОЖДЕНИЯ ЗАВТРА — ОКНО УЖЕ ОТКРЫТО, ЗА ЭТОТ ГОД', () => {
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-16'), 3, 3)).toBe(2026)
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-17'), 3, 3)).toBe(2026)
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-20'), 3, 3)).toBe(2026)
  })

  it('вне окна — подарка нет, границы включительно', () => {
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-13'), 3, 3)).toBeNull()
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-14'), 3, 3)).toBe(2026)
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-21'), 3, 3)).toBeNull()
    expect(birthdayYearInWindow(day('1990-09-17'), day('2026-09-16'), 0, 0)).toBeNull()
  })

  it('ОКНО ЧЕРЕЗ НОВЫЙ ГОД: 2 ЯНВАРЯ — ЗА ПРОШЛЫЙ ДЕНЬ РОЖДЕНИЯ, 31 ДЕКАБРЯ — ЗА БУДУЩИЙ', () => {
    expect(birthdayYearInWindow(day('1985-12-30'), day('2027-01-02'), 3, 3)).toBe(2026)
    expect(birthdayYearInWindow(day('1985-01-02'), day('2026-12-31'), 3, 3)).toBe(2027)
  })

  it('29 февраля в невисокосный год празднуется 28-го', () => {
    expect(birthdayYearInWindow(day('2000-02-29'), day('2027-02-28'), 0, 0)).toBe(2027)
    expect(birthdayYearInWindow(day('2000-02-29'), day('2028-02-29'), 0, 0)).toBe(2028)
    expect(birthdayYearInWindow(day('2000-02-29'), day('2028-02-28'), 0, 0)).toBeNull()
  })
})

describe('День рождения в фильтре гостей', () => {
  it('СЕГОДНЯ — ТОЛЬКО СЕГОДНЯ, НЕ ЗАВТРА И НЕ ВЧЕРА', () => {
    const today = day('2026-10-08')

    expect(birthdayInWindow(day('1990-10-08'), today, 'today')).toBe(true)
    expect(birthdayInWindow(day('1990-10-09'), today, 'today')).toBe(false)
    expect(birthdayInWindow(day('1990-10-07'), today, 'today')).toBe(false)
  })

  it('НЕДЕЛЯ — СЕГОДНЯ И ШЕСТЬ ДНЕЙ ВПЕРЁД, ПРОШЕДШИЕ НЕ В СЧЁТ', () => {
    const today = day('2026-10-08')

    expect(birthdayInWindow(day('1990-10-08'), today, 'week')).toBe(true)
    expect(birthdayInWindow(day('1990-10-14'), today, 'week')).toBe(true)
    expect(birthdayInWindow(day('1990-10-15'), today, 'week')).toBe(false)
    expect(birthdayInWindow(day('1990-10-07'), today, 'week')).toBe(false)
  })

  it('НЕДЕЛЯ ПЕРЕХОДИТ ЧЕРЕЗ НОВЫЙ ГОД', () => {
    expect(birthdayInWindow(day('1985-01-02'), day('2026-12-29'), 'week')).toBe(true)
  })

  it('МЕСЯЦ — КАЛЕНДАРНЫЙ, 29 ФЕВРАЛЯ — В ФЕВРАЛЕ ЛЮБОГО ГОДА', () => {
    expect(birthdayInWindow(day('1990-10-31'), day('2026-10-01'), 'month')).toBe(true)
    expect(birthdayInWindow(day('1990-11-01'), day('2026-10-31'), 'month')).toBe(false)
    expect(birthdayInWindow(day('2000-02-29'), day('2027-02-10'), 'month')).toBe(true)
  })
})
