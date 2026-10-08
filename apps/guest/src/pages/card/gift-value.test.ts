import { describe, expect, it } from 'vitest'

import { dictionaries } from '../../shared/i18n/dictionaries'
import type { TranslationKey } from '../../shared/i18n/dictionaries'
import { giftValueText } from './gift-value'

/**
 * Гость решает «забирать или нет» по этой строке. Сумма без валюты или
 * процент без потолка здесь — обещание, которое касса потом не сдержит.
 */

const ru = (key: TranslationKey): string => dictionaries.ru[key]
const en = (key: TranslationKey): string => dictionaries.en[key]

describe('Что гость получит по сертификату', () => {
  it('СКИДКА СУММОЙ — В БАТАХ, А НЕ В САТАНГАХ', () => {
    expect(giftValueText({ kind: 'FIXED_OFF', amount: 50_000 }, ru)).toBe('Скидка 500,00 ฿')
  })

  it('ПРОЦЕНТ — С ПОТОЛКОМ, ЕСЛИ ОН ЕСТЬ', () => {
    expect(giftValueText({ kind: 'PERCENT_OFF', percent: 10, maxDiscount: null }, ru)).toBe(
      'Скидка 10%',
    )
    expect(giftValueText({ kind: 'PERCENT_OFF', percent: 15, maxDiscount: 30_000 }, ru)).toBe(
      'Скидка 15%, но не больше 300,00 ฿',
    )
  })

  it('ПОДАРОК — НАЗВАНИЕМ, И НА ЯЗЫКЕ ГОСТЯ', () => {
    expect(giftValueText({ kind: 'FREE_ITEM', itemName: 'Капучино' }, ru)).toBe(
      'В подарок: Капучино',
    )
    expect(giftValueText({ kind: 'FREE_ITEM', itemName: 'Cappuccino' }, en)).toBe(
      'Free: Cappuccino',
    )
  })
})
