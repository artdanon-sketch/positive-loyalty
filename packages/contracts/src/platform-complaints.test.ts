import { describe, expect, it } from 'vitest'

import { PlatformComplaintsResult, PlatformComplaintsReviewResult } from './platform.js'

const ROW = {
  tenantId: '71717171-7171-4717-8717-717171717171',
  brandName: 'Phuket Ride',
  openComplaints: 5,
  suspended: true,
  lastComplaintAt: '2026-09-15T12:00:00.000Z',
  complaints: [
    {
      fromTenantId: '72727272-7272-4727-8727-727272727272',
      fromBrandName: 'Kata Beach Kitchen',
      reason: 'Рассылка всем подряд',
      createdAt: '2026-09-15T12:00:00.000Z',
    },
  ],
}

describe('Жалобы для панели платформы: контракт', () => {
  it('строка с жалобщиками и причинами проходит, причина может отсутствовать', () => {
    expect(PlatformComplaintsResult.safeParse({ items: [ROW], suspendAfter: 5 }).success).toBe(true)
    expect(
      PlatformComplaintsResult.safeParse({
        items: [{ ...ROW, complaints: [{ ...ROW.complaints[0], reason: null }] }],
        suspendAfter: 5,
      }).success,
    ).toBe(true)
  })

  it('без порога приостановки и с лишними полями — нет', () => {
    expect(PlatformComplaintsResult.safeParse({ items: [ROW] }).success).toBe(false)
    expect(
      PlatformComplaintsResult.safeParse({ items: [{ ...ROW, phone: '+66' }], suspendAfter: 5 })
        .success,
    ).toBe(false)
  })

  it('итог разбора — сколько жалоб отмечено', () => {
    expect(
      PlatformComplaintsReviewResult.safeParse({ tenantId: ROW.tenantId, reviewed: 0 }).success,
    ).toBe(true)
    expect(
      PlatformComplaintsReviewResult.safeParse({ tenantId: ROW.tenantId, reviewed: -1 }).success,
    ).toBe(false)
  })
})
