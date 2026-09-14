import { describe, expect, it } from 'vitest'

import { IdempotencyKeyHeader, IssueGiftInput, IssueGiftResult } from './gift.js'

describe('Подарок гостю: запрос', () => {
  it('десерт за долгое ожидание — срок по умолчанию две недели', () => {
    expect(IssueGiftInput.parse({ title: '  Десерт ', reason: 'LONG_WAIT' })).toEqual({
      title: 'Десерт',
      reason: 'LONG_WAIT',
      validityDays: 14,
    })
  })

  it('«ДРУГАЯ ПРИЧИНА» БЕЗ КОММЕНТАРИЯ НЕ ПРОХОДИТ — через месяц никто не вспомнит, за что', () => {
    const result = IssueGiftInput.safeParse({ title: 'Десерт', reason: 'OTHER' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['comment'])
  })

  it('с комментарием «другая причина» проходит', () => {
    expect(
      IssueGiftInput.safeParse({ title: 'Десерт', reason: 'OTHER', comment: 'Сосед по столику' })
        .success,
    ).toBe(true)
  })

  it('без названия и с лишним полем — отказ', () => {
    expect(IssueGiftInput.safeParse({ title: ' ', reason: 'LONG_WAIT' }).success).toBe(false)
    expect(
      IssueGiftInput.safeParse({ title: 'Десерт', reason: 'LONG_WAIT', points: 1000 }).success,
    ).toBe(false)
  })

  it('срок — от дня до трёх месяцев', () => {
    expect(
      IssueGiftInput.safeParse({ title: 'Десерт', reason: 'LONG_WAIT', validityDays: 0 }).success,
    ).toBe(false)
    expect(
      IssueGiftInput.safeParse({ title: 'Десерт', reason: 'LONG_WAIT', validityDays: 91 }).success,
    ).toBe(false)
  })
})

describe('Подарок гостю: ответ и ключ', () => {
  it('ПОЛНЫЙ КОД В ОТВЕТ НЕ ПРОЛЕЗЕТ', () => {
    const answer = {
      grantId: '71717171-7171-4717-8717-717171717171',
      title: 'Десерт',
      codeTail: 'Q7XR',
      expiresAt: '2026-09-29T12:00:00.000Z',
      replayed: false,
    }

    expect(IssueGiftResult.safeParse(answer).success).toBe(true)
    expect(IssueGiftResult.safeParse({ ...answer, codeTail: '7K2QX9MPQ7XR' }).success).toBe(false)
  })

  it('ключ повтора — не пустышка и без пробелов', () => {
    expect(IdempotencyKeyHeader.safeParse('0f6c2d9e-5b1a-4c3e-9d7f-2a8b4c6d1e3f').success).toBe(
      true,
    )
    expect(IdempotencyKeyHeader.safeParse('123').success).toBe(false)
    expect(IdempotencyKeyHeader.safeParse('ключ с пробелами').success).toBe(false)
  })
})
