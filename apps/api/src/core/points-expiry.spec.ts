import { describe, expect, it } from 'vitest'

import { expiringPoints, expiryCutoff, expiryKey } from './points-expiry'

/**
 * Это арифметика чужих денег: ошибка здесь сжигает баллы, которые гость
 * заработал вчера, и узнает он об этом у стойки.
 */

const facts = (extra: Partial<Parameters<typeof expiringPoints>[0]> = {}) => ({
  earnedBeforeCutoff: 0,
  spentTotal: 0,
  balance: 0,
  ...extra,
})

describe('Сгорание баллов: сколько сгорает', () => {
  it('ВСЁ СТАРОЕ, ЕСЛИ НИЧЕГО НЕ ТРАТИЛИ', () => {
    expect(expiringPoints(facts({ earnedBeforeCutoff: 500, balance: 500 }))).toBe(500)
  })

  it('СПИСАНИЯ ГАСЯТ СНАЧАЛА САМЫЕ СТАРЫЕ БАЛЛЫ', () => {
    // Год копил 500, недавно потратил 300 — сгореть должно 200, а не 500.
    expect(expiringPoints(facts({ earnedBeforeCutoff: 500, spentTotal: 300, balance: 200 }))).toBe(
      200,
    )
  })

  it('ПОТРАТИЛ БОЛЬШЕ, ЧЕМ НАКОПИЛ СТАРОГО, — СГОРАТЬ НЕЧЕМУ', () => {
    // Старых 100, новых 400, потратил 150: старые погашены целиком.
    expect(expiringPoints(facts({ earnedBeforeCutoff: 100, spentTotal: 150, balance: 350 }))).toBe(
      0,
    )
  })

  it('БОЛЬШЕ ОСТАТКА НЕ СГОРАЕТ: ГОСТЬ МОГ РАСПЛАТИТЬСЯ МЕЖДУ РАСЧЁТОМ И ЗАПИСЬЮ', () => {
    expect(expiringPoints(facts({ earnedBeforeCutoff: 500, balance: 120 }))).toBe(120)
  })

  it('ОТРИЦАТЕЛЬНОГО СГОРАНИЯ НЕ БЫВАЕТ', () => {
    expect(expiringPoints(facts({ earnedBeforeCutoff: 0, spentTotal: 90, balance: 10 }))).toBe(0)
  })
})

describe('Сгорание баллов: рубеж и ключ', () => {
  it('РУБЕЖ СЧИТАЕТСЯ ОТ НАЧАЛА СУТОК: ГОСТЬ НЕ ТЕРЯЕТ БАЛЛЫ В ОБЕД', () => {
    const cutoff = expiryCutoff(new Date('2026-09-18T14:35:00'), 30)

    expect(cutoff.getHours()).toBe(0)
    expect(cutoff.getMinutes()).toBe(0)
  })

  it('РУБЕЖ ОТСТОИТ РОВНО НА ЗАДАННОЕ ЧИСЛО ДНЕЙ', () => {
    const now = new Date('2026-09-18T14:35:00')
    const cutoff = expiryCutoff(now, 30)
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)

    expect((start.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000)).toBe(30)
  })

  it('КЛЮЧ СОДЕРЖИТ ДАТУ: ВТОРОЙ ПРОХОД ЗА ДЕНЬ НЕ СОЖЖЁТ ПОВТОРНО', () => {
    const morning = expiryKey('m-1', new Date('2026-09-18T06:00:00Z'))
    const evening = expiryKey('m-1', new Date('2026-09-18T21:00:00Z'))
    const tomorrow = expiryKey('m-1', new Date('2026-09-19T06:00:00Z'))

    expect(morning).toBe(evening)
    expect(morning).not.toBe(tomorrow)
  })
})
