import { describe, expect, it } from 'vitest'

import { t } from '../i18n'
import type { TranslationKey } from '../i18n'
import { certificateValueText } from './value-text'

const ru = (key: TranslationKey): string => t(key)

describe('Что даёт сертификат — словами', () => {
  it('НОМИНАЛ В БАТАХ, ХОТЯ ХРАНИТСЯ В САТАНГАХ', () => {
    expect(certificateValueText({ kind: 'FIXED_OFF', amount: 50_000 }, ru)).toMatch(
      /^скидка 500,00 ฿$/,
    )
  })

  it('процент — с потолком и без, подарок — названием', () => {
    expect(certificateValueText({ kind: 'PERCENT_OFF', percent: 10, maxDiscount: null }, ru)).toBe(
      'скидка 10%',
    )
    expect(
      certificateValueText({ kind: 'PERCENT_OFF', percent: 10, maxDiscount: 30_000 }, ru),
    ).toMatch(/^скидка 10%, не больше 300,00 ฿$/)
    expect(certificateValueText({ kind: 'FREE_ITEM', itemName: 'Десерт' }, ru)).toBe(
      'в подарок: Десерт',
    )
  })
})
