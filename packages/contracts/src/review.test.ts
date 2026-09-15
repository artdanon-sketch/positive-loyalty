import { describe, expect, it } from 'vitest'

import { ReviewSettings } from './review-config.js'
import { AdminReviewsQuery, CreateReviewInput } from './review.js'
import { ProgramConfig } from './tenant.js'

const ENTRY = '51515151-5151-4515-8515-515151515151'

describe('Отзывы', () => {
  it('ОЦЕНКА — ЦЕЛОЕ ОТ 1 ДО 5, ТЕМЫ БЕЗ ПОВТОРОВ, ТЕКСТ НЕОБЯЗАТЕЛЕН', () => {
    expect(CreateReviewInput.parse({ ledgerEntryId: ENTRY, rating: 2 })).toEqual({
      ledgerEntryId: ENTRY,
      rating: 2,
      tags: [],
    })

    for (const rating of [0, 6, 4.5]) {
      expect(CreateReviewInput.safeParse({ ledgerEntryId: ENTRY, rating }).success).toBe(false)
    }

    expect(
      CreateReviewInput.safeParse({ ledgerEntryId: ENTRY, rating: 3, tags: ['PRICE', 'PRICE'] })
        .success,
    ).toBe(false)
    expect(
      CreateReviewInput.safeParse({ ledgerEntryId: ENTRY, rating: 3, tags: ['TASTE'] }).success,
    ).toBe(false)
  })

  it('АВТООТВЕТЫ — РОВНО ПЯТЬ МЕСТ, ПО УМОЛЧАНИЮ ПУСТЫЕ, ПРОБЕЛ — НЕ ОТВЕТ', () => {
    expect(ProgramConfig.parse({}).reviews.autoReplies).toEqual([null, null, null, null, null])
    expect(ReviewSettings.safeParse({ autoReplies: [null, null, null, null] }).success).toBe(false)
    expect(
      ReviewSettings.safeParse({ autoReplies: ['Спасибо!', null, null, null, '   '] }).success,
    ).toBe(false)
  })

  it('список: период по умолчанию — месяц, оценка и страница приходят строкой адреса', () => {
    expect(AdminReviewsQuery.parse({ rating: '2', answered: 'no' })).toEqual({
      period: '30d',
      rating: 2,
      answered: 'no',
      limit: 20,
      offset: 0,
    })
  })
})
