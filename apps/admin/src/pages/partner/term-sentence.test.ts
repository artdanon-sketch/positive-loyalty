import { describe, expect, it } from 'vitest'

import { t } from '../../shared/i18n'
import { describeTerm } from './term-sentence'

const ru = (key: Parameters<typeof t>[0]): string => t(key, 'ru')

const LIMITS = { totalGrants: 200, perGuest: 1, dailyCap: 10 }

describe('Условие одной фразой', () => {
  it('ГОЛОВНОЙ ПРИМЕР: ресторан дарит ролл гостям студии за абонемент', () => {
    const { sentence, limits } = describeTerm(
      {
        direction: 'WE_GIVE',
        trigger: {
          type: 'ON_SALE_KIND',
          saleKindId: '41414141-4141-4414-8414-414141414141',
          minAmount: 500_000,
        },
        reward: { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
        validityDays: 14,
        limits: LIMITS,
        saleKindName: 'Абонемент на месяц',
      },
      'Dance Studio Kata',
      ru,
    )

    expect(sentence).toMatch(
      /^За «Абонемент на месяц» от 5\s000 ฿ у Dance Studio Kata — мы дарим «Ролл Филадельфия» при чеке от 800 ฿\.$/,
    )
    expect(limits).toBe(
      'Код живёт 14 дн. Всего не больше 200. В день не больше 10. Одному гостю — 1.',
    )
  })

  it('обратное направление: у нас покупают — партнёр дарит', () => {
    const { sentence } = describeTerm(
      {
        direction: 'THEY_GIVE',
        trigger: { type: 'ON_PURCHASE', minAmount: 0 },
        reward: { kind: 'PERCENT_OFF', percent: 15, maxDiscount: 30_000 },
        validityDays: 7,
        limits: { totalGrants: null, perGuest: 1, dailyCap: null },
        saleKindName: null,
      },
      'Sabai Spa',
      ru,
    )

    expect(sentence).toBe('За любую покупку у нас — Sabai Spa дарит скидку 15% не больше 300 ฿.')
  })

  it('без лимитов — только срок и «одному гостю»', () => {
    const { limits } = describeTerm(
      {
        direction: 'WE_GIVE',
        trigger: { type: 'ON_NTH_VISIT', n: 3 },
        reward: { kind: 'FIXED_OFF', amount: 10_000, minCheck: 0 },
        validityDays: 30,
        limits: { totalGrants: null, perGuest: 2, dailyCap: null },
        saleKindName: null,
      },
      'Кафе',
      ru,
    )

    expect(limits).toBe('Код живёт 30 дн. Одному гостю — 2.')
  })
})
