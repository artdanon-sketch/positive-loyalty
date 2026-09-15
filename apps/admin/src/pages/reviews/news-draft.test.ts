import { describe, expect, it } from 'vitest'

import { BLANK_NEWS, fromNewsDraft } from './news-draft'

describe('Черновик новости', () => {
  it('ПРОБЕЛЫ ПО КРАЯМ СРЕЗАЮТСЯ, ГАЛОЧКА «СРАЗУ ГОСТЯМ» УХОДИТ КАК ЕСТЬ', () => {
    expect(fromNewsDraft({ title: ' Новое меню ', body: ' Суп дня ', publish: true })).toEqual({
      ok: true,
      input: { title: 'Новое меню', body: 'Суп дня', publish: true },
    })
  })

  it('ПЕРВАЯ ПРОБЛЕМА ПО ПОРЯДКУ: ЗАГОЛОВОК, ПОТОМ ТЕКСТ', () => {
    expect(fromNewsDraft(BLANK_NEWS)).toEqual({ ok: false, problem: 'title' })
    expect(fromNewsDraft({ ...BLANK_NEWS, title: 'Меню', body: '   ' })).toEqual({
      ok: false,
      problem: 'body',
    })
    expect(fromNewsDraft({ ...BLANK_NEWS, title: 'я'.repeat(121), body: 'Текст' })).toEqual({
      ok: false,
      problem: 'title',
    })
    expect(fromNewsDraft({ ...BLANK_NEWS, title: 'Меню', body: 'я'.repeat(2001) })).toEqual({
      ok: false,
      problem: 'body',
    })
  })
})
