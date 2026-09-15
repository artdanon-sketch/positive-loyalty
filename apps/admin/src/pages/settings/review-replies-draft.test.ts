import { describe, expect, it } from 'vitest'

import { fromRepliesDraft, toRepliesDraft } from './review-replies-draft'

describe('Черновик автоответов', () => {
  it('ПУСТОЕ ПОЛЕ — БЕЗ АВТООТВЕТА, ПРОБЕЛЫ ПО КРАЯМ СРЕЗАЮТСЯ', () => {
    expect(toRepliesDraft({ autoReplies: [null, null, null, null, 'Спасибо!'] })).toEqual([
      '',
      '',
      '',
      '',
      'Спасибо!',
    ])

    expect(fromRepliesDraft(['  ', '', '', '', ' Спасибо! Ждём вас снова. '])).toEqual({
      ok: true,
      settings: { autoReplies: [null, null, null, null, 'Спасибо! Ждём вас снова.'] },
    })
  })

  it('СЛИШКОМ ДЛИННЫЙ ОТВЕТ — ПРОБЛЕМА С НОМЕРОМ ОЦЕНКИ', () => {
    expect(fromRepliesDraft(['', 'я'.repeat(1001), '', '', ''])).toEqual({ ok: false, rating: 2 })
    expect(fromRepliesDraft(['', 'я'.repeat(1000), '', '', ''])).toMatchObject({ ok: true })
  })
})
