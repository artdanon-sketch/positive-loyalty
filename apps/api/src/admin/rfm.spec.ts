import { RfmSegment } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { frequencyScore, recencyScore, rfmSegment, segmentOf } from './rfm'

const NOW = new Date('2026-09-16T12:00:00.000Z')
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

describe('RFM-сегменты', () => {
  it('ЧЕМПИОН — БЫЛ НЕДАВНО И ПРИХОДИТ ЧАСТО; ТАКОЙ ЖЕ, НО ДАВНО НЕ БЫВШИЙ, — «НЕЛЬЗЯ ПОТЕРЯТЬ»', () => {
    expect(segmentOf({ lastVisitAt: daysAgo(3), visitsTotal: 12 }, NOW)).toBe('CHAMPIONS')
    expect(segmentOf({ lastVisitAt: daysAgo(200), visitsTotal: 12 }, NOW)).toBe('CANT_LOSE')
  })

  it('ОДНА ПОКУПКА: ВЧЕРА — НОВИЧОК, ПОЛГОДА НАЗАД — СПЯЩИЙ', () => {
    expect(segmentOf({ lastVisitAt: daysAgo(1), visitsTotal: 1 }, NOW)).toBe('NEW')
    expect(segmentOf({ lastVisitAt: daysAgo(45), visitsTotal: 1 }, NOW)).toBe('PROMISING')
    expect(segmentOf({ lastVisitAt: daysAgo(180), visitsTotal: 1 }, NOW)).toBe('HIBERNATING')
  })

  it('пороги давности и частоты — включительно', () => {
    expect([14, 15, 30, 31, 60, 61, 120, 121].map(recencyScore)).toEqual([5, 4, 4, 3, 3, 2, 2, 1])
    expect([1, 2, 3, 4, 5, 9, 10].map(frequencyScore)).toEqual([1, 2, 3, 3, 4, 4, 5])
  })

  it('В СЕТКЕ ВСТРЕЧАЮТСЯ ВСЕ ДЕСЯТЬ СЕГМЕНТОВ, А ОЦЕНКИ ВНЕ 1…5 — ОШИБКА', () => {
    const seen = new Set<string>()

    for (let recency = 1; recency <= 5; recency += 1) {
      for (let frequency = 1; frequency <= 5; frequency += 1) {
        seen.add(rfmSegment(recency, frequency))
      }
    }

    expect([...seen].sort()).toEqual([...RfmSegment.options].sort())
    expect(() => rfmSegment(0, 3)).toThrow(RangeError)
    expect(() => rfmSegment(3, 6)).toThrow(RangeError)
  })

  it('визит «в будущем» из-за часов кассы считается сегодняшним', () => {
    expect(segmentOf({ lastVisitAt: daysAgo(-1), visitsTotal: 5 }, NOW)).toBe('CHAMPIONS')
  })
})
