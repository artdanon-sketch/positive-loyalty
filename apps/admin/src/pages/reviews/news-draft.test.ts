import { describe, expect, it } from 'vitest'

import { BLANK_NEWS, fromNewsDraft } from './news-draft'

describe('Черновик новости', () => {
  it('ПРОБЕЛЫ ПО КРАЯМ СРЕЗАЮТСЯ, ГАЛОЧКА «СРАЗУ ГОСТЯМ» УХОДИТ КАК ЕСТЬ', () => {
    expect(
      fromNewsDraft({ ...BLANK_NEWS, title: ' Новое меню ', body: ' Суп дня ', publish: true }),
    ).toEqual({
      ok: true,
      input: {
        title: 'Новое меню',
        body: 'Суп дня',
        publish: true,
        imageUrl: null,
        notify: false,
      },
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

describe('Черновик новости: картинка и уведомление', () => {
  it('КАРТИНКА ТОЛЬКО ПО HTTPS: ПО HTTP БРАУЗЕР ЕЁ ЗАБЛОКИРУЕТ', () => {
    const draft = { ...BLANK_NEWS, title: 'Меню', body: 'Суп', imageUrl: 'http://a.example/x.jpg' }

    expect(fromNewsDraft(draft)).toEqual({ ok: false, problem: 'image' })
    expect(fromNewsDraft({ ...draft, imageUrl: 'https://a.example/x.jpg' })).toMatchObject({
      ok: true,
    })
  })

  it('ПУСТАЯ ССЫЛКА — ЭТО «БЕЗ КАРТИНКИ», А НЕ ОШИБКА', () => {
    const result = fromNewsDraft({ ...BLANK_NEWS, title: 'Меню', body: 'Суп', imageUrl: '   ' })

    expect(result).toMatchObject({ ok: true, input: { imageUrl: null } })
  })

  it('СООБЩАТЬ О ЧЕРНОВИКЕ НЕКОМУ: БЕЗ ПУБЛИКАЦИИ УВЕДОМЛЕНИЕ НЕ УХОДИТ', () => {
    const draft = { ...BLANK_NEWS, title: 'Меню', body: 'Суп', notify: true }

    expect(fromNewsDraft(draft)).toMatchObject({ ok: true, input: { notify: false } })
    expect(fromNewsDraft({ ...draft, publish: true })).toMatchObject({
      ok: true,
      input: { notify: true },
    })
  })
})
