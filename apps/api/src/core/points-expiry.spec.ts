import { describe, expect, it } from 'vitest'

import { expiringPoints, expiryCutoff, expiryKey, upcomingExpiry } from './points-expiry'

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

describe('Сгорание баллов: предупреждение заранее', () => {
  const day = 24 * 60 * 60 * 1000
  const now = new Date('2026-09-18T12:00:00')

  it('СГОРИТ ТА ПАРТИЯ, КОТОРУЮ НЕ ПОГАСИЛИ СПИСАНИЯ', () => {
    const earns = [
      { at: new Date(now.getTime() - 20 * day), amount: 300 },
      { at: new Date(now.getTime() - 5 * day), amount: 200 },
    ]

    // Потрачено 100: гасится самая старая партия, от неё остаётся 200.
    expect(upcomingExpiry(earns, 100, 30, now)).toMatchObject({ points: 200 })
  })

  it('ПАРТИИ ПРИШЛИ НЕ ПО ПОРЯДКУ — СПИСАНИЯ ВСЁ РАВНО ГАСЯТ САМУЮ СТАРУЮ', () => {
    // Чек из кассы POSitive досылается позже и встаёт в выборку после свежего
    // чека с экрана кассира, хотя по дате операции он старше.
    const earns = [
      { at: new Date(now.getTime() - 5 * day), amount: 200 },
      { at: new Date(now.getTime() - 20 * day), amount: 300 },
    ]

    const result = upcomingExpiry(earns, 100, 30, now)

    expect(result).toMatchObject({ points: 200 })
    expect(result?.at.getTime()).toBe(now.getTime() - 20 * day + 30 * day)
  })

  it('ДАТА — ЭТО ДЕНЬ НАЧИСЛЕНИЯ ПЛЮС СРОК', () => {
    const at = new Date(now.getTime() - 10 * day)
    const result = upcomingExpiry([{ at, amount: 500 }], 0, 30, now)

    expect(result?.at.getTime()).toBe(at.getTime() + 30 * day)
  })

  it('ПАРТИЯ, УЖЕ ПЕРЕШЕДШАЯ РУБЕЖ, СГОРИТ БЛИЖАЙШИМ ПРОХОДОМ', () => {
    const result = upcomingExpiry(
      [{ at: new Date(now.getTime() - 60 * day), amount: 400 }],
      0,
      30,
      now,
    )

    expect(result).toMatchObject({ points: 400, at: now })
  })

  it('ВСЁ ПОТРАЧЕНО — ТЕРЯТЬ НЕЧЕГО, И ПРЕДУПРЕЖДАТЬ НЕ О ЧЕМ', () => {
    const earns = [{ at: new Date(now.getTime() - 20 * day), amount: 300 }]

    expect(upcomingExpiry(earns, 300, 30, now)).toBeNull()
  })

  it('НАЧИСЛЕНИЙ НЕ БЫЛО — ТОЖЕ null, А НЕ НОЛЬ БАЛЛОВ', () => {
    expect(upcomingExpiry([], 0, 30, now)).toBeNull()
  })
})
