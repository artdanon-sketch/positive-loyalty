import type { Tier } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { checkRates, needsReferrals, resolveTier } from './tiers'
import type { TierFacts } from './tiers'

const tier = (id: string, conditions: Tier['conditions'], patch: Partial<Tier> = {}): Tier => ({
  id,
  name: id,
  earnRate: 5,
  redeemRate: 20,
  hidden: false,
  conditions,
  ...patch,
})

const BASE = tier('base', [])
const SILVER = tier('silver', [{ type: 'VISITS_TOTAL', gt: 4 }], { earnRate: 7 })
const GOLD = tier(
  'gold',
  [
    { type: 'SPENT_TOTAL', gt: 1_000_000 },
    { type: 'REFERRALS', gt: 2 },
  ],
  { earnRate: 10, redeemRate: 50 },
)
const VIP = tier('vip', [], { hidden: true, earnRate: 15 })

const LADDER = [BASE, SILVER, GOLD, VIP]

const facts = (patch: Partial<TierFacts> = {}): TierFacts => ({
  tierId: null,
  tierManual: false,
  spentTotal: 0,
  visitsTotal: 0,
  referrals: 0,
  ...patch,
})

describe('Статус гостя: лестница', () => {
  it('ВХОДНОЙ — У ЛЮБОГО УЧАСТНИКА; ВЫШЕ — ПО ЛЮБОМУ ИЗ УСЛОВИЙ; САМЫЙ ВЫСОКИЙ ПОБЕЖДАЕТ', () => {
    expect(resolveTier(LADDER, facts())).toBe(BASE)
    expect(resolveTier(LADDER, facts({ visitsTotal: 5 }))).toBe(SILVER)
    // Сумма за один визит: «Серебро» не набрано, «Золото» — да.
    expect(resolveTier(LADDER, facts({ spentTotal: 1_000_001, visitsTotal: 1 }))).toBe(GOLD)
    expect(resolveTier(LADDER, facts({ referrals: 3 }))).toBe(GOLD)
  })

  it('ПОРОГ СТРОГИЙ: РОВНО НА ПОРОГЕ — ЕЩЁ НЕТ', () => {
    expect(resolveTier(LADDER, facts({ visitsTotal: 4 }))).toBe(BASE)
    expect(resolveTier(LADDER, facts({ spentTotal: 1_000_000 }))).toBe(BASE)
  })

  it('СКРЫТЫЙ СТАТУС САМ НЕ ДАЁТСЯ — ДАЖЕ БЕЗ УСЛОВИЙ', () => {
    expect(resolveTier([VIP], facts({ spentTotal: 99_000_000 }))).toBeNull()
    expect(resolveTier([], facts())).toBeNull()
  })
})

describe('Статус гостя: не понижаем и ручной', () => {
  it('АВТОМАТИЧЕСКИ СТАТУС ТОЛЬКО РАСТЁТ: ОТМЕНА ЧЕКА НЕ ОТБИРАЕТ «ЗОЛОТО»', () => {
    expect(resolveTier(LADDER, facts({ tierId: 'gold', spentTotal: 0 }))).toBe(GOLD)
    expect(resolveTier(LADDER, facts({ tierId: 'base', visitsTotal: 10 }))).toBe(SILVER)
  })

  it('РУЧНОЙ СТАТУС НЕ ПЕРЕСЧИТЫВАЕТСЯ — НИ ВВЕРХ, НИ ВНИЗ', () => {
    expect(resolveTier(LADDER, facts({ tierId: 'vip', tierManual: true }))).toBe(VIP)
    expect(
      resolveTier(LADDER, facts({ tierId: 'base', tierManual: true, spentTotal: 5_000_000 })),
    ).toBe(BASE)
  })

  it('статус удалили из настроек — гость возвращается на лестницу', () => {
    expect(
      resolveTier(LADDER, facts({ tierId: 'deleted', tierManual: true, visitsTotal: 5 })),
    ).toBe(SILVER)
    expect(resolveTier(LADDER, facts({ tierId: 'deleted' }))).toBe(BASE)
  })

  it('скрытый статус без ручной отметки не держится — это рассинхрон, а не привилегия', () => {
    expect(resolveTier(LADDER, facts({ tierId: 'vip' }))).toBe(BASE)
  })
})

describe('Статус гостя: ставки и рекомендации', () => {
  it('СТАТУС ЗАМЕНЯЕТ БАЗОВЫЕ СТАВКИ, А НЕ ПРИБАВЛЯЕТСЯ К НИМ', () => {
    const config = { baseEarnRate: 5, baseRedeemRate: 20 }

    expect(checkRates(config, GOLD)).toEqual({ earnRate: 10, redeemRate: 50 })
    expect(checkRates(config, null)).toEqual({ earnRate: 5, redeemRate: 20 })
  })

  it('рекомендации считаем, только если на них есть условие у открытого статуса', () => {
    expect(needsReferrals(LADDER)).toBe(true)
    expect(needsReferrals([BASE, SILVER])).toBe(false)
    expect(needsReferrals([tier('secret', [{ type: 'REFERRALS', gt: 0 }], { hidden: true })])).toBe(
      false,
    )
  })
})
