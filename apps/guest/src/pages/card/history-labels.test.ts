import { describe, expect, it } from 'vitest'
import type { GuestHistoryEntry } from '@positive/contracts'

import { HISTORY_LABEL, historyTone, signedPoints } from './history-labels'

/**
 * История — то место, где гость проверяет нас на честность. Строка «ADJUST»
 * или «+-80» здесь выглядит как сбой, даже когда всё работает.
 */

const entry = (points: number): GuestHistoryEntry => ({
  id: '00000000-0000-4000-8000-000000000000',
  at: '2026-09-18T10:00:00.000Z',
  tenantId: '00000000-0000-4000-8000-000000000001',
  venue: 'Kata Beach Kitchen',
  type: 'EARN',
  points,
  basisAmount: null,
  balanceAfter: 0,
})

describe('История: как показываем баллы', () => {
  it('НАЧИСЛЕНИЕ С ПЛЮСОМ, СПИСАНИЕ С ТИПОГРАФСКИМ МИНУСОМ', () => {
    expect(signedPoints(120)).toBe('+120')
    expect(signedPoints(-80)).toBe('−80')
  })

  it('НОЛЬ ОСТАЁТСЯ НУЛЁМ, БЕЗ ЗНАКА: ОТМЕНА БЕЗ БАЛЛОВ — НЕ ПОТЕРЯ', () => {
    expect(signedPoints(0)).toBe('0')
  })

  it('ЗНАК ОПЕРАЦИИ ЧИТАЕТСЯ ИЗ ЧИСЛА, А НЕ ИЗ ТИПА ЗАПИСИ', () => {
    expect(historyTone(entry(10))).toBe('up')
    expect(historyTone(entry(-10))).toBe('down')
    expect(historyTone(entry(0))).toBe('flat')
  })
})

describe('История: человеческие названия', () => {
  it('У КАЖДОГО ТИПА ЗАПИСИ ЕСТЬ СВОЯ ПОДПИСЬ — НИ ОДИН НЕ ПОКАЖЕТСЯ КОДОМ', () => {
    for (const type of ['EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL', 'GRANT'] as const) {
      expect(HISTORY_LABEL[type]).toMatch(/^history\.kind\./)
    }
  })

  it('ПОДПИСИ НЕ ПОВТОРЯЮТСЯ: ПОКУПКА И ПОДАРОК — РАЗНЫЕ СОБЫТИЯ', () => {
    const labels = Object.values(HISTORY_LABEL)

    expect(new Set(labels).size).toBe(labels.length)
  })
})
