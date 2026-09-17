import { describe, expect, it } from 'vitest'

import { forecastReward, fromStaffRewardDraft, toStaffRewardDraft } from './staff-reward-draft'
import type { StaffRewardDraft } from './staff-reward-draft'

/** Ошибка здесь — это ошибка в зарплате кассира, поэтому проверяем числами. */

const draft = (extra: Partial<StaffRewardDraft> = {}): StaffRewardDraft => ({
  enabled: true,
  basis: 'PER_NEW_GUEST',
  value: '100',
  vesting: 'ON_SECOND_VISIT',
  shiftCap: '15',
  ...extra,
})

describe('Черновик доплаты кассирам', () => {
  it('ФИКСИРОВАННАЯ НАГРАДА — В БАТАХ НА ЭКРАНЕ, В САТАНГАХ НА СЕРВЕРЕ', () => {
    const checked = fromStaffRewardDraft(draft())

    expect(checked).toEqual({
      ok: true,
      settings: {
        enabled: true,
        basis: 'PER_NEW_GUEST',
        value: 10_000,
        vesting: 'ON_SECOND_VISIT',
        shiftCap: 15,
      },
    })
  })

  it('ПРОЦЕНТ ОСТАЁТСЯ ПРОЦЕНТОМ, А НЕ ПРЕВРАЩАЕТСЯ В САТАНГИ', () => {
    const checked = fromStaffRewardDraft(draft({ basis: 'PCT_OF_REVENUE', value: '1.5' }))

    expect(checked).toMatchObject({ ok: true, settings: { value: 1.5 } })
  })

  it('ТУДА И ОБРАТНО — ТО ЖЕ САМОЕ', () => {
    const settings = {
      enabled: true,
      basis: 'PER_NEW_GUEST' as const,
      value: 25_000,
      vesting: 'IMMEDIATE' as const,
      shiftCap: 40,
    }

    expect(fromStaffRewardDraft(toStaffRewardDraft(settings))).toEqual({ ok: true, settings })
  })

  it('ВЫКЛЮЧЕННАЯ ДОПЛАТА СОХРАНЯЕТСЯ БЕЗ ПРОВЕРКИ СУММЫ', () => {
    expect(fromStaffRewardDraft(draft({ enabled: false, value: '' }))).toMatchObject({
      ok: true,
      settings: { enabled: false, value: 0 },
    })
  })

  it('ПУСТАЯ, НУЛЕВАЯ И СЛИШКОМ БОЛЬШАЯ СУММА — НЕ СОХРАНЯЕМ', () => {
    expect(fromStaffRewardDraft(draft({ value: '' }))).toEqual({ ok: false, problem: 'value' })
    expect(fromStaffRewardDraft(draft({ value: '0' }))).toEqual({ ok: false, problem: 'value' })
    expect(fromStaffRewardDraft(draft({ value: '10001' }))).toEqual({ ok: false, problem: 'value' })
    expect(fromStaffRewardDraft(draft({ basis: 'PCT_OF_POINTS', value: '51' }))).toEqual({
      ok: false,
      problem: 'value',
    })
  })

  it('ЛИМИТ СМЕНЫ — ЦЕЛОЕ ЧИСЛО ДО ДВУХСОТ', () => {
    expect(fromStaffRewardDraft(draft({ shiftCap: '1.5' }))).toEqual({
      ok: false,
      problem: 'shiftCap',
    })
    expect(fromStaffRewardDraft(draft({ shiftCap: '201' }))).toEqual({
      ok: false,
      problem: 'shiftCap',
    })
    expect(fromStaffRewardDraft(draft({ shiftCap: '0' }))).toMatchObject({ ok: true })
  })

  it('ЗАПЯТАЯ ВМЕСТО ТОЧКИ — ЭТО ТО ЖЕ ЧИСЛО: ТАК НАБИРАЮТ С ТЕЛЕФОНА', () => {
    expect(fromStaffRewardDraft(draft({ basis: 'PCT_OF_REVENUE', value: '2,5' }))).toMatchObject({
      ok: true,
      settings: { value: 2.5 },
    })
  })
})

describe('Во сколько обойдётся доплата', () => {
  const facts = {
    receipts: 300,
    newGuests: 60,
    turnover: 3_000_000,
    pointsEarned: 150_000,
    days: 30,
  }

  it('ЗА НОВОГО ГОСТЯ: ШЕСТЬДЕСЯТ ГОСТЕЙ ПО СТО БАТ — ДВЕ ТЫСЯЧИ В ДЕНЬ', () => {
    const forecast = forecastReward(
      { enabled: true, basis: 'PER_NEW_GUEST', value: 10_000, vesting: 'IMMEDIATE', shiftCap: 15 },
      facts,
    )

    expect(forecast.perDay).toBe(20_000)
    expect(forecast.perMonth).toBe(600_000)
    expect(forecast.pctOfTurnover).toBe(20)
  })

  it('ПРОЦЕНТ ОТ ВЫРУЧКИ СЧИТАЕТСЯ ОТ ОБОРОТА, А ОТ БАЛЛОВ — ОТ БАЛЛОВ', () => {
    const ofRevenue = forecastReward(
      { enabled: true, basis: 'PCT_OF_REVENUE', value: 1, vesting: 'IMMEDIATE', shiftCap: 15 },
      facts,
    )
    expect(ofRevenue.pctOfTurnover).toBe(1)

    const ofPoints = forecastReward(
      { enabled: true, basis: 'PCT_OF_POINTS', value: 10, vesting: 'IMMEDIATE', shiftCap: 15 },
      facts,
    )
    expect(ofPoints.perMonth).toBe(15_000)
  })

  it('ВЫКЛЮЧЕННАЯ ДОПЛАТА НЕ СТОИТ НИЧЕГО; БЕЗ ОБОРОТА ДОЛЯ НЕИЗВЕСТНА', () => {
    const off = forecastReward(
      { enabled: false, basis: 'PER_NEW_GUEST', value: 10_000, vesting: 'IMMEDIATE', shiftCap: 15 },
      facts,
    )
    expect(off).toEqual({ perDay: 0, perMonth: 0, pctOfTurnover: null })

    const noRevenue = forecastReward(
      { enabled: true, basis: 'PER_NEW_GUEST', value: 10_000, vesting: 'IMMEDIATE', shiftCap: 15 },
      { ...facts, turnover: 0 },
    )
    expect(noRevenue.pctOfTurnover).toBeNull()
  })
})
