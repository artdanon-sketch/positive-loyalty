import { describe, expect, it } from 'vitest'

import { POS_QUEUE_REPORT_MAX, PosQueueReport } from './pos-queue.js'

const ITEM = {
  receiptId: 'pos-lx2k9-a1b2c3',
  amount: 125_000,
  target: { kind: 'PHONE', phone: '+66812344821' },
  attempts: 20,
  lastError: 'Номер чека обязателен',
  queuedAt: '2026-09-15T09:00:00.000Z',
}

describe('Снимок очереди планшета', () => {
  it('принимает снимок с чеком по телефону и с найденным участником', () => {
    const report = {
      terminalId: '0f6c2d9e-5b1a-4c3e-9d7f-2a8b4c6d1e3f',
      items: [
        ITEM,
        {
          ...ITEM,
          receiptId: 'pos-lx2k9-d4e5f6',
          target: { kind: 'MEMBERSHIP', membershipId: '66666666-6666-4666-8666-666666666666' },
        },
      ],
    }

    expect(PosQueueReport.safeParse(report).success).toBe(true)
  })

  it('пустой снимок — это «у меня ничего не лежит», а не ошибка', () => {
    expect(PosQueueReport.safeParse({ terminalId: 'terminal-0001', items: [] }).success).toBe(true)
  })

  it('без метки планшета или с мусором вместо неё — отказ', () => {
    expect(PosQueueReport.safeParse({ items: [] }).success).toBe(false)
    expect(PosQueueReport.safeParse({ terminalId: 'пл 1', items: [] }).success).toBe(false)
  })

  it('больше двухсот чеков — это уже поломка, а не очередь', () => {
    const items = Array.from({ length: POS_QUEUE_REPORT_MAX + 1 }, (_, index) => ({
      ...ITEM,
      receiptId: `pos-${String(index)}`,
    }))

    expect(PosQueueReport.safeParse({ terminalId: 'terminal-0001', items }).success).toBe(false)
  })

  it('лишнее поле в чеке отвергается', () => {
    const report = { terminalId: 'terminal-0001', items: [{ ...ITEM, earned: 6_250 }] }

    expect(PosQueueReport.safeParse(report).success).toBe(false)
  })
})
