import { describe, expect, it } from 'vitest'

import { groupComplaints } from './invite-complaints'

const at = (minutes: number): Date => new Date(Date.UTC(2026, 8, 15, 12, minutes))

const strike = (against: string, from: string, minutes: number) => ({
  againstTenantId: against,
  againstBrandName: `Заведение ${against}`,
  fromTenantId: from,
  fromBrandName: `Жалобщик ${from}`,
  createdAt: at(minutes),
})

describe('Жалобы для панели платформы', () => {
  it('одно заведение, пожаловавшееся дважды, — одна жалоба с датой последней', () => {
    const [row] = groupComplaints([strike('a', 'x', 1), strike('a', 'x', 5)], [])

    expect(row).toMatchObject({
      tenantId: 'a',
      brandName: 'Заведение a',
      openComplaints: 1,
      suspended: false,
      lastComplaintAt: at(5).toISOString(),
    })
    expect(row?.complaints).toEqual([
      {
        fromTenantId: 'x',
        fromBrandName: 'Жалобщик x',
        reason: null,
        createdAt: at(5).toISOString(),
      },
    ])
  })

  it('причина — из блокировки именно этой пары', () => {
    const [row] = groupComplaints(
      [strike('a', 'x', 1)],
      [
        { blockerTenantId: 'x', blockedTenantId: 'b', reason: 'чужая пара' },
        { blockerTenantId: 'x', blockedTenantId: 'a', reason: 'Рассылка всем подряд' },
      ],
    )

    expect(row?.complaints[0]?.reason).toBe('Рассылка всем подряд')
  })

  it('ПЯТЬ РАЗНЫХ — ПРИОСТАНОВЛЕН; ПРИОСТАНОВЛЕННЫЕ ПЕРВЫМИ, ДАЛЬШЕ — ПО ЧИСЛУ ЖАЛОБ', () => {
    const rows = groupComplaints(
      [
        strike('quiet', 'x', 50),
        ...['p', 'q', 'r', 's', 't'].map((from, index) => strike('loud', from, index)),
        strike('two', 'x', 10),
        strike('two', 'y', 11),
      ],
      [],
    )

    expect(rows.map((row) => [row.tenantId, row.openComplaints, row.suspended])).toEqual([
      ['loud', 5, true],
      ['two', 2, false],
      ['quiet', 1, false],
    ])
  })

  it('жалоб нет — и строк нет', () => {
    expect(groupComplaints([], [])).toEqual([])
  })
})
