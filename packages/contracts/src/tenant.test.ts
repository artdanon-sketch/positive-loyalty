import { describe, expect, it } from 'vitest'

import { ProgramConfig, parseProgramConfig } from './tenant.js'

/**
 * Настройки программы лояльности.
 *
 * Главный тест здесь — «полный документ из ТЗ разбирается». Он появился не от
 * хорошей жизни: схема была объявлена по подмножеству полей, которое умел
 * считать код, а `.strict()` отвергала всё остальное. Заведение, настроенное
 * ровно по docs/01, раздел 4.3, ломало кассу — предрасчёт отдавал 500 на
 * `Unrecognized keys: "ordering", "staffReward"`.
 *
 * Прежние тесты этого не ловили, потому что подавали на вход настройки,
 * слепленные под ту же схему. Тест на данных собственной формы доказывает
 * только то, что схема равна себе.
 */

/**
 * Настройки заведения ровно как в docs/01, раздел 4.3 — со всеми полями.
 * Значения взяты из Kata Beach Kitchen (`prisma/demo-data.ts`): именно этот
 * набор и падал.
 */
const FULL_CONFIG = {
  mode: 'CASHBACK',
  baseEarnRate: 5,
  baseRedeemRate: 30,
  pointsExpireDays: 365,
  welcomeBonus: { enabled: true, amount: 5_000, trigger: 'ON_FIRST_PURCHASE' },
  tiers: [
    { id: 'base', name: 'Гость', earnRate: 5, redeemRate: 30, hidden: false, conditions: [] },
    {
      id: 'vip',
      name: 'VIP',
      earnRate: 10,
      redeemRate: 50,
      hidden: false,
      conditions: [{ type: 'SPENT_TOTAL', gt: 1_500_000 }],
    },
  ],
  cashierRules: { requireReceiptNumber: true, maxManualAmount: 300_000, allowManualEntry: true },
  staffReward: {
    enabled: true,
    basis: 'PER_NEW_GUEST',
    value: 2_000,
    vesting: 'ON_SECOND_VISIT',
    shiftCap: 15,
  },
  ordering: { mode: 'EXTERNAL_LINK', url: 'https://kata-beach-kitchen.example/order' },
}

describe('ProgramConfig', () => {
  it('разбирает полный документ из ТЗ, а не подмножество, удобное коду', () => {
    const config = parseProgramConfig(FULL_CONFIG)

    expect(config.staffReward.basis).toBe('PER_NEW_GUEST')
    expect(config.staffReward.shiftCap).toBe(15)
    expect(config.ordering.mode).toBe('EXTERNAL_LINK')
    expect(config.tiers).toHaveLength(2)
  })

  it('заведение без настроек работает на значениях по умолчанию', () => {
    // Владелец завёл заведение и до настроек ещё не дошёл: первый чек обязан
    // пробиться, а не упасть на валидации конфигурации.
    const config = parseProgramConfig({})

    expect(config.mode).toBe('CASHBACK')
    expect(config.baseEarnRate).toBe(5)
    expect(config.staffReward.enabled).toBe(false)
    expect(config.ordering.mode).toBe('OFF')
  })

  it('null из колонки Json тоже даёт значения по умолчанию', () => {
    expect(parseProgramConfig(null).baseRedeemRate).toBe(20)
  })

  it('опечатка в названии поля отвергается, а не игнорируется молча', () => {
    // Ради этого `.strict()` и стоит: проигнорированный `baseEarnRatio`
    // означал бы, что заведение платит 5% вместо настроенных 12 и узнаёт
    // об этом из отчёта в конце месяца.
    expect(() => parseProgramConfig({ ...FULL_CONFIG, baseEarnRatio: 12 })).toThrow()
  })

  it('держит границы ставок', () => {
    expect(() => ProgramConfig.parse({ baseEarnRate: 80 })).toThrow()
    expect(() => ProgramConfig.parse({ baseRedeemRate: 140 })).toThrow()
  })
})
