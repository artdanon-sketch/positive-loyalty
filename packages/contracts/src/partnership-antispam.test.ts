import { describe, expect, it } from 'vitest'

import { BlockPartnershipInput, InviteQuotaView } from './partnership.js'

describe('Антиспам приглашений: контракт', () => {
  it('блокировка без тела — не жалоба', () => {
    expect(BlockPartnershipInput.parse({})).toEqual({ spam: false })
  })

  it('жалоба с причиной проходит; строка вместо флага и лишние поля — нет', () => {
    expect(BlockPartnershipInput.parse({ spam: true, reason: 'Рассылка всем подряд' })).toEqual({
      spam: true,
      reason: 'Рассылка всем подряд',
    })
    expect(BlockPartnershipInput.safeParse({ spam: 'yes' }).success).toBe(false)
    expect(BlockPartnershipInput.safeParse({ spam: true, severity: 5 }).success).toBe(false)
  })

  it('квота говорит об ограничении: охлаждение с датой, приостановка без неё или ничего', () => {
    const base = { freeLimit: 1, freeUsed: 0, freeLeft: 1 }

    expect(InviteQuotaView.safeParse({ ...base, restriction: null }).success).toBe(true)
    expect(
      InviteQuotaView.safeParse({
        ...base,
        restriction: { kind: 'COOLING', until: '2026-10-15T12:00:00.000Z' },
      }).success,
    ).toBe(true)
    expect(InviteQuotaView.safeParse({ ...base, restriction: { kind: 'SUSPENDED' } }).success).toBe(
      true,
    )
    expect(InviteQuotaView.safeParse({ ...base, restriction: { kind: 'COOLING' } }).success).toBe(
      false,
    )
    expect(InviteQuotaView.safeParse(base).success).toBe(false)
  })
})
