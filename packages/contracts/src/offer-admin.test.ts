import { describe, expect, it } from 'vitest'

import { CreateOfferInput, OfferSimulation, SimulateOfferInput } from './offer-admin.js'

const RETURN_TOMORROW = {
  type: 'PROMO_ON_CHECK',
  title: 'Вернём 200 ฿',
  limits: { minCheck: 80_000, perGuestQty: 1 },
  reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 20_000 }, validityDays: 1 },
}

describe('Конструктор акций: контракт', () => {
  it('шаблон «вернуть гостя завтра» проходит, остальное — по умолчанию', () => {
    expect(CreateOfferInput.parse(RETURN_TOMORROW)).toEqual({
      ...RETURN_TOMORROW,
      audience: { kind: 'ALL' },
      schedule: {},
      stackable: true,
      priority: 100,
      launch: 'NOW',
    })
  })

  it('НАГРАДА ОБЯЗАНА ПОДХОДИТЬ К ТИПУ: КЭШБЭК С ПРОМОКОДОМ — ОТКАЗ ПО ПОЛЮ НАГРАДЫ', () => {
    const result = CreateOfferInput.safeParse({ ...RETURN_TOMORROW, type: 'CASHBACK' })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('reward')
  })

  it('акция не может закончиться раньше, чем начнётся', () => {
    const result = CreateOfferInput.safeParse({
      ...RETURN_TOMORROW,
      schedule: { startsAt: '2026-09-20T00:00:00+07:00', endsAt: '2026-09-19T23:59:00+07:00' },
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('schedule.endsAt')
  })

  it('партнёрский тип, пустое название и лишние поля не проходят', () => {
    expect(
      CreateOfferInput.safeParse({ ...RETURN_TOMORROW, type: 'NETWORK_VOUCHER' }).success,
    ).toBe(false)
    expect(CreateOfferInput.safeParse({ ...RETURN_TOMORROW, title: ' ' }).success).toBe(false)
    expect(CreateOfferInput.safeParse({ ...RETURN_TOMORROW, tenantId: 'чужой' }).success).toBe(
      false,
    )
  })

  it('прогноз принимает правила без названия', () => {
    const { title: _title, ...rules } = RETURN_TOMORROW

    expect(SimulateOfferInput.safeParse(rules).success).toBe(true)
  })

  it('прогноз: либо цифры, либо причина, почему их нет', () => {
    expect(
      OfferSimulation.safeParse({ insufficientData: true, reason: 'Данных пока мало' }).success,
    ).toBe(true)
    expect(
      OfferSimulation.safeParse({
        insufficientData: false,
        days: 30,
        guests: 84,
        grants: 84,
        bonusPoints: null,
        cost: 1_680_000,
      }).success,
    ).toBe(true)
    expect(OfferSimulation.safeParse({ insufficientData: true, guests: 84 }).success).toBe(false)
  })
})
