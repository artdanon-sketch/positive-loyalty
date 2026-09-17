import { StaffRewardConfig } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { decideStaffReward, vestsImmediately } from './staff-reward'

/**
 * Каждое правило здесь стоит владельцу денег при ошибке, поэтому проверяется
 * отдельно — и то, за что платим, и то, за что не платим.
 */

const config = (extra: Partial<StaffRewardConfig> = {}): StaffRewardConfig =>
  StaffRewardConfig.parse({ enabled: true, basis: 'PER_NEW_GUEST', value: 2000, ...extra })

const facts = (extra: Partial<Parameters<typeof decideStaffReward>[1]> = {}) => ({
  pointsEarned: 500,
  basisAmount: 100_000,
  isNewGuest: true,
  selfLinked: false,
  rewardsThisShift: 0,
  ...extra,
})

describe('Мотивация кассира: за что платим', () => {
  it('ЗА НОВОГО ГОСТЯ — ФИКСИРОВАННАЯ СУММА', () => {
    expect(decideStaffReward(config(), facts())).toEqual({ paid: true, amount: 2000 })
  })

  it('ПРОЦЕНТ ОТ НАЧИСЛЕННЫХ БАЛЛОВ И ПРОЦЕНТ ОТ ВЫРУЧКИ СЧИТАЮТСЯ ОТ РАЗНОГО', () => {
    const ofPoints = decideStaffReward(config({ basis: 'PCT_OF_POINTS', value: 10 }), facts())
    expect(ofPoints).toEqual({ paid: true, amount: 50 })

    const ofRevenue = decideStaffReward(config({ basis: 'PCT_OF_REVENUE', value: 1 }), facts())
    expect(ofRevenue).toEqual({ paid: true, amount: 1000 })
  })

  it('ПРОЦЕНТОМ ПЛАТИМ И ЗА ПОСТОЯННОГО: ЭТО ПЛАТА ЗА ЧЕК, А НЕ ЗА ЗНАКОМСТВО', () => {
    const decision = decideStaffReward(
      config({ basis: 'PCT_OF_REVENUE', value: 1 }),
      facts({ isNewGuest: false }),
    )

    expect(decision).toEqual({ paid: true, amount: 1000 })
  })
})

describe('Мотивация кассира: за что не платим', () => {
  it('ЧЕК НА СВОЙ НОМЕР НЕ ОПЛАЧИВАЕТСЯ НИ ПО КАКОЙ БАЗЕ', () => {
    for (const basis of ['PER_NEW_GUEST', 'PCT_OF_POINTS', 'PCT_OF_REVENUE'] as const) {
      expect(decideStaffReward(config({ basis }), facts({ selfLinked: true }))).toEqual({
        paid: false,
        reason: 'Чек на гостя с номером самого сотрудника',
      })
    }
  })

  it('ЗА ПОСТОЯННОГО ГОСТЯ ПРИ ОПЛАТЕ «ЗА НОВОГО» — НЕ ПЛАТИМ', () => {
    expect(decideStaffReward(config(), facts({ isNewGuest: false }))).toEqual({
      paid: false,
      reason: 'Гость не новый, а платим только за новых',
    })
  })

  it('ЛИМИТ СМЕНЫ — ПОТОЛОК, А НЕ ОТСРОЧКА', () => {
    const tight = config({ shiftCap: 3 })

    expect(decideStaffReward(tight, facts({ rewardsThisShift: 2 }))).toEqual({
      paid: true,
      amount: 2000,
    })
    expect(decideStaffReward(tight, facts({ rewardsThisShift: 3 }))).toEqual({
      paid: false,
      reason: 'Достигнут лимит наград за смену',
    })
  })

  it('ВЫКЛЮЧЕННАЯ ДОПЛАТА И НУЛЕВОЕ ЗНАЧЕНИЕ — ЭТО ОТКАЗ, А НЕ НОЛЬ', () => {
    expect(decideStaffReward(config({ enabled: false }), facts())).toEqual({
      paid: false,
      reason: 'Доплата выключена в настройках',
    })
    expect(decideStaffReward(config({ value: 0 }), facts())).toEqual({
      paid: false,
      reason: 'Доплата выключена в настройках',
    })
  })

  it('ЧЕК БЕЗ СУММЫ ПРИ ОПЛАТЕ ПРОЦЕНТОМ ОТ ВЫРУЧКИ НЕ ПРИНОСИТ НИЧЕГО', () => {
    const decision = decideStaffReward(
      config({ basis: 'PCT_OF_REVENUE', value: 5 }),
      facts({ basisAmount: null }),
    )

    expect(decision).toEqual({ paid: false, reason: 'Нулевая награда при таких настройках' })
  })

  it('КОПЕЙКИ ОКРУГЛЯЮТСЯ ВНИЗ — В ПОЛЬЗУ ЗАВЕДЕНИЯ, А НЕ НАОБОРОТ', () => {
    const decision = decideStaffReward(
      config({ basis: 'PCT_OF_POINTS', value: 33 }),
      facts({ pointsEarned: 10 }),
    )

    expect(decision).toEqual({ paid: true, amount: 3 })
  })
})

describe('Мотивация кассира: когда награда дозревает', () => {
  it('ПО УМОЛЧАНИЮ — НА ВТОРОМ ВИЗИТЕ, И ЭТО НАДО ВЫБРАТЬ ЯВНО', () => {
    expect(vestsImmediately(config())).toBe(false)
    expect(vestsImmediately(config({ vesting: 'IMMEDIATE' }))).toBe(true)
  })
})
