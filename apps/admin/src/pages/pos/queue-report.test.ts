import { beforeEach, describe, expect, it } from 'vitest'
import { PosQueueReport } from '@positive/contracts'

import type { QueuedSale } from './offline-queue'
import {
  rememberReported,
  snapshotSignature,
  terminalId,
  toReport,
  wasReportedNonEmpty,
} from './queue-report'

const SALE: QueuedSale = {
  receiptId: 'pos-lx2k9-a1b2c3',
  tenantId: '00000000-0000-4000-8000-000000000002',
  target: { kind: 'PHONE', phone: '+66812344821' },
  amount: 125_000,
  receiptNumber: '1042',
  queuedAt: Date.UTC(2026, 8, 15, 9, 0),
  attempts: 20,
  lastError: 'Номер чека обязателен',
}

describe('Снимок очереди для владельца', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('метка планшета одна и та же между перезагрузками', () => {
    const first = terminalId()

    expect(first).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(terminalId()).toBe(first)
  })

  it('СНИМОК, КОТОРЫЙ СОБИРАЕТ КАССА, ПРОХОДИТ КОНТРАКТ СЕРВЕРА', () => {
    const report = toReport(terminalId(), [
      SALE,
      {
        ...SALE,
        receiptId: 'pos-lx2k9-d4e5f6',
        target: { kind: 'MEMBERSHIP', membershipId: '66666666-6666-4666-8666-666666666666' },
      },
    ])

    expect(PosQueueReport.safeParse(report).success).toBe(true)
    expect(report.items[0]).toMatchObject({
      receiptId: SALE.receiptId,
      queuedAt: '2026-09-15T09:00:00.000Z',
      receiptNumber: '1042',
    })
  })

  it('длинная причина обрезается, а не роняет весь снимок', () => {
    const report = toReport(terminalId(), [{ ...SALE, lastError: 'ы'.repeat(1_000) }])

    expect(report.items[0]?.lastError).toHaveLength(300)
    expect(PosQueueReport.safeParse(report).success).toBe(true)
  })

  it('подпись меняется, когда меняются попытки, — и только тогда', () => {
    expect(snapshotSignature([SALE])).toBe(snapshotSignature([{ ...SALE }]))
    expect(snapshotSignature([SALE])).not.toBe(snapshotSignature([{ ...SALE, attempts: 21 }]))
  })

  it('помнит, что прошлый снимок был непустым, — чтобы потом прислать пустой', () => {
    expect(wasReportedNonEmpty()).toBe(false)

    rememberReported(true)
    expect(wasReportedNonEmpty()).toBe(true)

    rememberReported(false)
    expect(wasReportedNonEmpty()).toBe(false)
  })
})
