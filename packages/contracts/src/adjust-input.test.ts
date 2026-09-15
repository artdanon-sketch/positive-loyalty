import { describe, expect, it } from 'vitest'

import { AdjustInput } from './ledger.js'

const MEMBERSHIP = '11111111-1111-4111-8111-111111111111'

const valid = {
  membershipId: MEMBERSHIP,
  amount: -2_000,
  idempotencyKey: `adjust:${MEMBERSHIP}:1`,
  source: 'STAFF_MANUAL',
  actorType: 'OWNER',
}

describe('Ручная правка в журнале: контракт', () => {
  it('сумма со знаком проходит в обе стороны', () => {
    expect(AdjustInput.safeParse(valid).success).toBe(true)
    expect(AdjustInput.safeParse({ ...valid, amount: 2_000 }).success).toBe(true)
  })

  it('НОЛЬ — НЕ ПРАВКА; У ПРАВКИ НЕТ СУММЫ ЧЕКА: ЭТО НЕ ПОКУПКА', () => {
    expect(AdjustInput.safeParse({ ...valid, amount: 0 }).success).toBe(false)
    expect(AdjustInput.safeParse({ ...valid, basisAmount: 100_000 }).success).toBe(false)
  })
})
