import { describe, expect, it } from 'vitest'

import { birthdayProblem, formatBirthday, todayIso } from './birthday-date'

const TODAY = '2026-09-16'

describe('Дата рождения гостя', () => {
  it('НАСТОЯЩАЯ ДАТА ПРОХОДИТ, СЕГОДНЯШНЯЯ — ТОЖЕ', () => {
    expect(birthdayProblem('1990-09-17', TODAY)).toBeNull()
    expect(birthdayProblem(TODAY, TODAY)).toBeNull()
  })

  it('ИЗ БУДУЩЕГО И РАНЬШЕ 1900 ГОДА — НЕ ОТПРАВЛЯЕТСЯ', () => {
    expect(birthdayProblem('2026-09-17', TODAY)).toBe('range')
    expect(birthdayProblem('1899-12-31', TODAY)).toBe('range')
    expect(birthdayProblem('1900-01-01', TODAY)).toBeNull()
  })

  it('ПУСТО, ЧУЖОЙ ФОРМАТ И 30 ФЕВРАЛЯ — РАЗНЫЕ ПРОБЛЕМЫ', () => {
    expect(birthdayProblem('  ', TODAY)).toBe('empty')
    expect(birthdayProblem('17.09.1990', TODAY)).toBe('format')
    expect(birthdayProblem('1990-02-30', TODAY)).toBe('format')
  })

  it('сегодня — по часам телефона, дата — днём вперёд', () => {
    expect(todayIso(new Date(2026, 8, 6))).toBe('2026-09-06')
    expect(formatBirthday('1990-09-17')).toBe('17.09.1990')
  })
})
