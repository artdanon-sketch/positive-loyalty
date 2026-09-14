import { describe, expect, it } from 'vitest'

import { OfferAudience, OfferLimits, OfferReward, OfferSchedule } from './offer-rules.js'

describe('Правила акции: контракт', () => {
  it('аудитория: «спящим» нужен срок, неизвестных аудиторий нет', () => {
    expect(OfferAudience.safeParse({ kind: 'ALL' }).success).toBe(true)
    expect(OfferAudience.safeParse({ kind: 'SLEEPING', notVisitedDays: 30 }).success).toBe(true)
    expect(OfferAudience.safeParse({ kind: 'SLEEPING' }).success).toBe(false)
    expect(OfferAudience.safeParse({ kind: 'VIP' }).success).toBe(false)
    expect(OfferAudience.safeParse({}).success).toBe(false)
  })

  it('расписание: окно ЧЧ:ММ, дни недели 1–7, лишнего нет', () => {
    expect(
      OfferSchedule.safeParse({
        startsAt: '2026-09-19T00:00:00+07:00',
        weekdays: [1, 2, 3, 4, 5],
        timeWindow: { from: '14:00', to: '17:00' },
      }).success,
    ).toBe(true)
    expect(OfferSchedule.safeParse({}).success).toBe(true)
    expect(OfferSchedule.safeParse({ timeWindow: { from: '9:00', to: '17:00' } }).success).toBe(
      false,
    )
    expect(OfferSchedule.safeParse({ timeWindow: { from: '17:00', to: '17:00' } }).success).toBe(
      false,
    )
    expect(OfferSchedule.safeParse({ weekdays: [0] }).success).toBe(false)
    expect(OfferSchedule.safeParse({ everyDay: true }).success).toBe(false)
  })

  it('награда: кэшбэк до 50%, промокод с подарком и сроком до 90 дней', () => {
    expect(OfferReward.safeParse({ kind: 'EARN_PERCENT', percent: 10 }).success).toBe(true)
    expect(OfferReward.safeParse({ kind: 'EARN_PERCENT', percent: 60 }).success).toBe(false)
    expect(
      OfferReward.safeParse({
        kind: 'GIFT_CODE',
        gift: { kind: 'FIXED_OFF', amount: 20_000 },
        validityDays: 1,
      }).success,
    ).toBe(true)
    expect(
      OfferReward.safeParse({
        kind: 'GIFT_CODE',
        gift: { kind: 'FIXED_OFF', amount: 200.5 },
        validityDays: 1,
      }).success,
    ).toBe(false)
    expect(
      OfferReward.safeParse({
        kind: 'GIFT_CODE',
        gift: { kind: 'FREE_ITEM', itemName: 'Десерт' },
        validityDays: 120,
      }).success,
    ).toBe(false)
  })

  it('лимиты: пусто можно, суммы — целые сатанги', () => {
    expect(OfferLimits.safeParse({}).success).toBe(true)
    expect(
      OfferLimits.safeParse({ minCheck: 80_000, perGuestQty: 1, totalQty: null }).success,
    ).toBe(true)
    expect(OfferLimits.safeParse({ minCheck: 800.5 }).success).toBe(false)
    expect(OfferLimits.safeParse({ dailyCap: 10 }).success).toBe(false)
  })
})
