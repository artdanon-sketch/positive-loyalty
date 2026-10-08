import { describe, expect, it } from 'vitest'

import { PreviewInput } from './pos.js'

/**
 * Вход предрасчёта. Главное — что флаг «скидку не дали» необязателен: касса,
 * обновившаяся позже сервера, его не шлёт и работает как раньше.
 */

const MEMBERSHIP = '6d2b7a9e-3f4c-4b8a-9c1d-2e5f6a7b8c9d'

describe('Предрасчёт: вход', () => {
  it('ОБЫЧНЫЙ ЧЕК — БЕЗ ФЛАГА, СКИДКА ПО РЕЖИМУ ПРОГРАММЫ', () => {
    const parsed = PreviewInput.parse({ membershipId: MEMBERSHIP, amount: 100_000 })

    expect(parsed.withoutDiscount).toBeUndefined()
    expect(parsed.redeemRequested).toBe(0)
  })

  it('ЧЕК ИЗ ОЧЕРЕДИ ПРИХОДИТ С «БЕЗ СКИДКИ»', () => {
    expect(
      PreviewInput.safeParse({ membershipId: MEMBERSHIP, amount: 100_000, withoutDiscount: true })
        .success,
    ).toBe(true)
  })

  it('СУММУ СКИДКИ КАССА НЕ ПРИСЫЛАЕТ: ЕЁ СЧИТАЕТ СЕРВЕР', () => {
    expect(
      PreviewInput.safeParse({ membershipId: MEMBERSHIP, amount: 100_000, discount: 5_000 })
        .success,
    ).toBe(false)
  })
})
