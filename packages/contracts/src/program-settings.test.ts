import { describe, expect, it } from 'vitest'

import { ProgramSettings } from './tenant.js'

/**
 * Настройки программы, которые меняет владелец.
 *
 * Главное здесь — не диапазоны, а граница: через этот вход нельзя сохранить
 * настройку, которую касса не соблюдает. Иначе владелец включил бы «сгорание
 * баллов через год» и был бы уверен, что баллы сгорают.
 */

const valid = {
  baseEarnRate: 5,
  baseRedeemRate: 20,
  cashierRules: { requireReceiptNumber: true, maxManualAmount: null, allowManualEntry: true },
}

describe('Настройки программы', () => {
  it('принимает обычные настройки', () => {
    expect(ProgramSettings.safeParse(valid).success).toBe(true)
  })

  it('ПРОЦЕНТ НАЧИСЛЕНИЯ — НЕ ВЫШЕ ПЯТИДЕСЯТИ', () => {
    // Выше — это уже не лояльность, а раздача выручки. Опечатка «500» вместо
    // «5.00» не должна доезжать до кассы.
    expect(ProgramSettings.safeParse({ ...valid, baseEarnRate: 50 }).success).toBe(true)
    expect(ProgramSettings.safeParse({ ...valid, baseEarnRate: 51 }).success).toBe(false)
    expect(ProgramSettings.safeParse({ ...valid, baseEarnRate: -1 }).success).toBe(false)
  })

  it('оплатить баллами больше всего чека нельзя', () => {
    expect(ProgramSettings.safeParse({ ...valid, baseRedeemRate: 100 }).success).toBe(true)
    expect(ProgramSettings.safeParse({ ...valid, baseRedeemRate: 101 }).success).toBe(false)
  })

  it('потолок ручного ввода — положительное целое в сатангах или без потолка', () => {
    const rules = (maxManualAmount: unknown) => ({
      ...valid,
      cashierRules: { ...valid.cashierRules, maxManualAmount },
    })

    expect(ProgramSettings.safeParse(rules(300_000)).success).toBe(true)
    expect(ProgramSettings.safeParse(rules(null)).success).toBe(true)
    expect(ProgramSettings.safeParse(rules(0)).success).toBe(false)
    // Дробные сатанги — это баты, по ошибке не умноженные на сто.
    expect(ProgramSettings.safeParse(rules(3000.5)).success).toBe(false)
  })

  it('НАСТРОЙКУ, КОТОРУЮ КАССА НЕ СОБЛЮДАЕТ, ЧЕРЕЗ ЭТОТ ВХОД НЕ СОХРАНИТЬ', () => {
    // Срок жизни баллов и приветственные баллы описаны в конфиге, но механики
    // под ними нет. Пропустить их здесь значило бы сохранить обещание,
    // которое никто не выполнит.
    expect(ProgramSettings.safeParse({ ...valid, pointsExpireDays: 365 }).success).toBe(false)
    expect(
      ProgramSettings.safeParse({ ...valid, welcomeBonus: { enabled: true, amount: 5000 } })
        .success,
    ).toBe(false)
  })

  it('поля обязательны — «не прислал» не превращается в «сбросить»', () => {
    const { baseRedeemRate: _dropped, ...withoutRedeem } = valid

    expect(ProgramSettings.safeParse(withoutRedeem).success).toBe(false)
  })
})
