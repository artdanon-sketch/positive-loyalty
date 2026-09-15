import { describe, expect, it } from 'vitest'

import { summarizeReviews } from './review-summary'

describe('Сводка отзывов', () => {
  it('ПУСТО — СРЕДНЕЙ НЕТ, НУЛИ ВЕЗДЕ, ТЕМЫ ВСЕ ПЯТЬ', () => {
    expect(summarizeReviews([])).toEqual({
      total: 0,
      average: null,
      distribution: [0, 0, 0, 0, 0],
      tags: [
        { tag: 'QUALITY', count: 0 },
        { tag: 'PRICE', count: 0 },
        { tag: 'ASSORTMENT', count: 0 },
        { tag: 'SERVICE', count: 0 },
        { tag: 'STAFF', count: 0 },
      ],
      unanswered: 0,
    })
  })

  it('СРЕДНЯЯ С ОДНИМ ЗНАКОМ, РАСПРЕДЕЛЕНИЕ ПО ЗВЁЗДАМ, ЖДУТ ОТВЕТА — ТОЛЬКО БЕЗ ОТВЕТА', () => {
    const summary = summarizeReviews([
      { rating: 5, tags: ['QUALITY'], reply: 'Спасибо! Ждём вас снова.' },
      { rating: 4, tags: ['QUALITY', 'PRICE'], reply: null },
      { rating: 2, tags: ['SERVICE'], reply: null },
    ])

    expect(summary.total).toBe(3)
    // 11 / 3 = 3,666… → 3,7
    expect(summary.average).toBe(3.7)
    expect(summary.distribution).toEqual([0, 1, 0, 1, 1])
    expect(summary.unanswered).toBe(2)
    // Чаще упомянутые сверху, при равенстве — порядок справочника.
    expect(summary.tags).toEqual([
      { tag: 'QUALITY', count: 2 },
      { tag: 'PRICE', count: 1 },
      { tag: 'SERVICE', count: 1 },
      { tag: 'ASSORTMENT', count: 0 },
      { tag: 'STAFF', count: 0 },
    ])
  })

  it('тема, упомянутая дважды в одном отзыве, считается один раз; неизвестная — ни разу', () => {
    const [first, ...rest] = summarizeReviews([
      { rating: 3, tags: ['PRICE', 'PRICE', 'TASTE'], reply: null },
    ]).tags

    expect(first).toEqual({ tag: 'PRICE', count: 1 })
    expect(rest.every((entry) => entry.count === 0)).toBe(true)
  })
})
