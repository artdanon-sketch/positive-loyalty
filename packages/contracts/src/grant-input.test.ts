import { describe, expect, it } from 'vitest'

import { GrantInput } from './ledger.js'

const MEMBERSHIP = '11111111-1111-4111-8111-111111111111'

const valid = {
  membershipId: MEMBERSHIP,
  amount: 5_000,
  idempotencyKey: `welcome:${MEMBERSHIP}`,
  source: 'SYSTEM',
  actorType: 'SYSTEM',
}

describe('Подарок баллами: контракт', () => {
  it('приветственные баллы проходят', () => {
    expect(GrantInput.safeParse(valid).success).toBe(true)
  })

  it('НОЛЬ И МИНУС — НЕ ПОДАРОК', () => {
    expect(GrantInput.safeParse({ ...valid, amount: 0 }).success).toBe(false)
    expect(GrantInput.safeParse({ ...valid, amount: -5_000 }).success).toBe(false)
  })

  it('У ПОДАРКА НЕТ СУММЫ ЧЕКА: ЭТО НЕ ВИЗИТ', () => {
    expect(GrantInput.safeParse({ ...valid, basisAmount: 100_000 }).success).toBe(false)
  })
})
