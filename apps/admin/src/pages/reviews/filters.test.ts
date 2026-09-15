import { describe, expect, it } from 'vitest'

import { filtersFromParams, reviewsPath } from './filters'

describe('Фильтры отзывов', () => {
  it('ОЦЕНКА И ОТВЕТ ЧИТАЮТСЯ ИЗ АДРЕСА, МУСОР — КАК «ВСЕ»', () => {
    expect(filtersFromParams(new URLSearchParams('rating=2&answered=no'))).toEqual({
      rating: 2,
      answered: 'no',
    })
    expect(filtersFromParams(new URLSearchParams('rating=7&answered=maybe'))).toEqual({
      rating: null,
      answered: null,
    })
    expect(filtersFromParams(new URLSearchParams('rating=2.5'))).toEqual({
      rating: null,
      answered: null,
    })
  })

  it('ЗАПРОС НЕСЁТ ПЕРИОД, СТРАНИЦУ И ТОЛЬКО ВЫБРАННЫЕ ФИЛЬТРЫ', () => {
    expect(reviewsPath('30d', { rating: 2, answered: 'no' }, 20)).toBe(
      '/admin/reviews?period=30d&limit=20&offset=20&rating=2&answered=no',
    )
    expect(reviewsPath('7d', { rating: null, answered: null }, 0)).toBe(
      '/admin/reviews?period=7d&limit=20&offset=0',
    )
  })
})
