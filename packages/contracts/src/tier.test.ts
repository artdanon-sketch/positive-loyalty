import { describe, expect, it } from 'vitest'

import { SetGuestTierInput, TierSettings } from './tier.js'

const GOLD = {
  id: 'gold',
  name: 'Золото',
  earnRate: 10,
  redeemRate: 50,
  hidden: false,
  conditions: [{ type: 'SPENT_TOTAL', gt: 1_000_000 }],
}

const BASE = { ...GOLD, id: 'base', name: 'Гость', earnRate: 5, redeemRate: 20, conditions: [] }

const valid = {
  tiers: [BASE, GOLD],
  welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
}

describe('Статусы гостей: контракт', () => {
  it('лестница с входным статусом и порогом проходит', () => {
    expect(TierSettings.safeParse(valid).success).toBe(true)
  })

  it('ДВА СТАТУСА С ОДНИМ ID ИЛИ НАЗВАНИЕМ — ОТКАЗ: ГОСТЬ И ОТЧЁТЫ ИХ НЕ РАЗЛИЧАТ', () => {
    expect(
      TierSettings.safeParse({ ...valid, tiers: [GOLD, { ...GOLD, name: 'Платина' }] }).success,
    ).toBe(false)
    expect(
      TierSettings.safeParse({ ...valid, tiers: [GOLD, { ...GOLD, id: 'gold-2', name: 'золото' }] })
        .success,
    ).toBe(false)
  })

  it('не больше десяти ступеней и по одному условию каждого вида', () => {
    const ladder = Array.from({ length: 11 }, (_, index) => ({
      ...GOLD,
      id: `t${String(index)}`,
      name: `Статус ${String(index)}`,
    }))

    expect(TierSettings.safeParse({ ...valid, tiers: ladder }).success).toBe(false)
    expect(
      TierSettings.safeParse({
        ...valid,
        tiers: [
          {
            ...GOLD,
            conditions: [
              { type: 'SPENT_TOTAL', gt: 1 },
              { type: 'SPENT_TOTAL', gt: 2 },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('начисление по статусу — не выше пятидесяти процентов, как и базовое; id — без пробелов', () => {
    expect(TierSettings.safeParse({ ...valid, tiers: [{ ...GOLD, earnRate: 51 }] }).success).toBe(
      false,
    )
    expect(TierSettings.safeParse({ ...valid, tiers: [{ ...GOLD, id: 'Gold VIP' }] }).success).toBe(
      false,
    )
  })

  it('ВКЛЮЧЁННЫЕ ПРИВЕТСТВЕННЫЕ БАЛЛЫ НЕ МОГУТ БЫТЬ НУЛЁМ; ВЫКЛЮЧЕННЫЕ — МОГУТ', () => {
    expect(
      TierSettings.safeParse({
        ...valid,
        welcomeBonus: { enabled: true, amount: 0, trigger: 'ON_JOIN' },
      }).success,
    ).toBe(false)
    expect(
      TierSettings.safeParse({
        ...valid,
        welcomeBonus: { enabled: false, amount: 0, trigger: 'ON_JOIN' },
      }).success,
    ).toBe(true)
  })

  it('поля обязательны — «не прислал статусы» не превращается в «удалить все»', () => {
    expect(TierSettings.safeParse({ welcomeBonus: valid.welcomeBonus }).success).toBe(false)
  })

  it('ручной статус — только с причиной; null возвращает на лестницу', () => {
    expect(
      SetGuestTierInput.safeParse({ tierId: 'gold', reason: 'Постоянный гость с открытия' })
        .success,
    ).toBe(true)
    expect(
      SetGuestTierInput.safeParse({ tierId: null, reason: 'Статус выдан по ошибке' }).success,
    ).toBe(true)
    expect(SetGuestTierInput.safeParse({ tierId: 'gold', reason: 'надо' }).success).toBe(false)
  })
})
