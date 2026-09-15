import { describe, expect, it } from 'vitest'

import { birthdayYearInWindow } from './birthday'

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
