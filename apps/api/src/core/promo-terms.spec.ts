import { describe, expect, it } from 'vitest'

import { limitsWith, promoLeft, promoOpen, scheduleWith, termsOf } from './promo-terms'

/**
 * Ошибка на границе окна — это гость, у которого «Забрать» не нажимается
 * в последний вечер промо, или код, выданный после конца.
 */

const START = '2026-10-01T00:00:00.000Z'
const END = '2026-10-31T23:59:59.999Z'

describe('Условия промо в полях акции', () => {
  it('ПУСТЫЕ ПОЛЯ — БЕЗ ОКНА И БЕЗ ТИРАЖА', () => {
    expect(termsOf({}, {})).toEqual({ startsAt: null, endsAt: null, limit: null })
    expect(termsOf(null, 'мусор')).toEqual({ startsAt: null, endsAt: null, limit: null })
  })

  it('ТУДА И ОБРАТНО — ТЕ ЖЕ УСЛОВИЯ', () => {
    const terms = { startsAt: START, endsAt: END, limit: 100 }

    expect(termsOf(scheduleWith({}, terms), limitsWith({}, terms))).toEqual(terms)
  })

  it('ПРАВКА ПРОМО НЕ СТИРАЕТ ОКНО ПО ВРЕМЕНИ СУТОК И «В ОДНИ РУКИ»', () => {
    const window = { timeWindow: { from: '12:00', to: '15:00' } }

    expect(scheduleWith(window, { startsAt: null, endsAt: END, limit: null })).toEqual({
      timeWindow: { from: '12:00', to: '15:00' },
      endsAt: END,
    })
    expect(
      limitsWith({ perGuestQty: 1, totalQty: 50 }, { startsAt: null, endsAt: null, limit: null }),
    ).toEqual({
      perGuestQty: 1,
    })
  })

  it('ОКНО: В МОМЕНТ НАЧАЛА УЖЕ МОЖНО, В МОМЕНТ КОНЦА ЕЩЁ МОЖНО, ПОСЛЕ — НЕТ', () => {
    const terms = { startsAt: START, endsAt: END, limit: null }

    expect(promoOpen(terms, new Date(Date.parse(START) - 1))).toBe(false)
    expect(promoOpen(terms, new Date(START))).toBe(true)
    expect(promoOpen(terms, new Date(END))).toBe(true)
    expect(promoOpen(terms, new Date(Date.parse(END) + 1))).toBe(false)
    expect(promoOpen({ startsAt: null, endsAt: null, limit: null }, new Date())).toBe(true)
  })

  it('ОСТАТОК НЕ УХОДИТ В МИНУС, ДАЖЕ ЕСЛИ ВЫДАНО БОЛЬШЕ ТИРАЖА', () => {
    expect(promoLeft({ startsAt: null, endsAt: null, limit: 100 }, 12)).toBe(88)
    expect(promoLeft({ startsAt: null, endsAt: null, limit: 10 }, 15)).toBe(0)
    expect(promoLeft({ startsAt: null, endsAt: null, limit: null }, 15)).toBeNull()
  })
})
