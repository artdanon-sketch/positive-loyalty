import { describe, expect, it } from 'vitest'

import { checkout, type CheckoutFacts } from './checkout-math'

/**
 * Каждая цифра здесь — деньги гостя или расход заведения. Ошибка на сатанг
 * в пользу гостя умножается на все чеки острова, в пользу заведения — на
 * доверие к программе.
 */

const BASE: CheckoutFacts = {
  amount: 100_000,
  redeemRequested: 0,
  balance: 0,
  earnRate: 5,
  redeemRate: 20,
  mode: 'CASHBACK',
  isControlGroup: false,
  withoutDiscount: false,
}

describe('Арифметика чека', () => {
  it('БАЛЛЫ: ЧЕК ЦЕЛИКОМ, ПЯТЬ ПРОЦЕНТОВ НА СЛЕДУЮЩИЙ ВИЗИТ', () => {
    expect(checkout(BASE)).toEqual({
      discount: 0,
      maxRedeemable: 0,
      redeem: 0,
      amountToPay: 100_000,
      basePoints: 5_000,
    })
  })

  it('СКИДКА: ТЕ ЖЕ ПЯТЬ ПРОЦЕНТОВ СРАЗУ, А БАЛЛОВ С ПОКУПКИ НЕТ', () => {
    expect(checkout({ ...BASE, mode: 'DISCOUNT' })).toEqual({
      discount: 5_000,
      maxRedeemable: 0,
      redeem: 0,
      amountToPay: 95_000,
      basePoints: 0,
    })
  })

  it('НАКОПЛЕННОЕ ТРАТИТСЯ И В РЕЖИМЕ СКИДКИ — ДОЛЕЙ ТОГО, ЧТО ОСТАЛОСЬ ПОСЛЕ НЕЁ', () => {
    const result = checkout({
      ...BASE,
      mode: 'DISCOUNT',
      balance: 50_000,
      redeemRequested: 50_000,
    })

    // 1000 ฿ − 50 ฿ скидки = 950 ฿; баллами — не больше 20 % от 950, то есть 190.
    expect(result).toMatchObject({ discount: 5_000, maxRedeemable: 19_000, redeem: 19_000 })
    expect(result.amountToPay).toBe(76_000)
  })

  it('КОНТРОЛЬНОЙ ГРУППЕ — НИ СКИДКИ, НИ БАЛЛОВ', () => {
    for (const mode of ['CASHBACK', 'DISCOUNT'] as const) {
      expect(checkout({ ...BASE, mode, isControlGroup: true })).toMatchObject({
        discount: 0,
        amountToPay: 100_000,
        basePoints: 0,
      })
    }
  })

  it('ЧЕК УЖЕ ОПЛАЧЕН ЦЕЛИКОМ — ВМЕСТО СКИДКИ БАЛЛЫ ПО ТОЙ ЖЕ СТАВКЕ', () => {
    expect(checkout({ ...BASE, mode: 'DISCOUNT', withoutDiscount: true })).toEqual(checkout(BASE))
  })

  it('ОКРУГЛЕНИЕ ВНИЗ: СКИДКА С 999,99 ฿ ПРИ 7 % — 69,99 ฿, А НЕ 70', () => {
    const result = checkout({ ...BASE, amount: 99_999, earnRate: 7, mode: 'DISCOUNT' })

    expect(result.discount).toBe(6_999)
    expect(result.amountToPay).toBe(93_000)
  })

  it('ПРОСЯТ СПИСАТЬ БОЛЬШЕ ПОТОЛКА — СПИСЫВАЕТСЯ ПОТОЛОК', () => {
    expect(checkout({ ...BASE, balance: 1_000, redeemRequested: 99_999 })).toMatchObject({
      maxRedeemable: 1_000,
      redeem: 1_000,
      amountToPay: 99_000,
      basePoints: 4_950,
    })
  })
})
