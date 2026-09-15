import { describe, expect, it } from 'vitest'

import { AdminOfferCard, AdminOffersQuery } from './offer.js'

const CARD = {
  id: '52525252-5252-4525-8525-525252525252',
  status: 'LIVE',
  title: 'Ролл Филадельфия в подарок',
  howTo: ['Покажите код на кассе'],
  partner: { partnershipId: '31313131-3131-4313-8313-313131313131', name: 'Dance Studio Kata' },
  issued: 12,
  redeemed: 7,
  returned: 3,
  actions: { publish: false, pause: false, end: false },
  createdAt: '2026-09-14T10:00:00.000Z',
}

describe('Список акций: контракт', () => {
  it('по умолчанию — все акции, по-русски', () => {
    expect(AdminOffersQuery.parse({})).toEqual({ filter: 'ALL', locale: 'ru' })
  })

  it('фильтры — только чипы из docs/03: все, идут, запланированы, завершены', () => {
    expect(AdminOffersQuery.safeParse({ filter: 'LIVE' }).success).toBe(true)
    expect(AdminOffersQuery.safeParse({ filter: 'DRAFT' }).success).toBe(false)
  })

  it('карточка партнёрской акции и своей — обе проходят', () => {
    expect(AdminOfferCard.safeParse(CARD).success).toBe(true)
    expect(AdminOfferCard.safeParse({ ...CARD, partner: null }).success).toBe(true)
  })

  it('отрицательных цифр и лишних полей не бывает', () => {
    expect(AdminOfferCard.safeParse({ ...CARD, returned: -1 }).success).toBe(false)
    expect(AdminOfferCard.safeParse({ ...CARD, revenue: 100 }).success).toBe(false)
  })

  it('кнопки приходят с сервера всегда — экран их не угадывает', () => {
    const { actions: _actions, ...withoutActions } = CARD

    expect(AdminOfferCard.safeParse(withoutActions).success).toBe(false)
    expect(
      AdminOfferCard.safeParse({ ...CARD, actions: { publish: true, pause: false } }).success,
    ).toBe(false)
  })
})
