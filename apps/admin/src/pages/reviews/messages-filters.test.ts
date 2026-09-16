import { describe, expect, it } from 'vitest'

import { messagesPath, NO_MESSAGE_FILTERS } from './messages-filters'

describe('Фильтры жалоб и предложений', () => {
  it('БЕЗ ФИЛЬТРОВ И НА ПЕРВОЙ СТРАНИЦЕ — ЧИСТЫЙ АДРЕС', () => {
    expect(messagesPath(NO_MESSAGE_FILTERS, 0)).toBe('/admin/messages')
  })

  it('ВИД, ОТВЕТ И СТРАНИЦА СКЛАДЫВАЮТСЯ В ОДИН ЗАПРОС', () => {
    expect(messagesPath({ kind: 'COMPLAINT', answered: 'no' }, 20)).toBe(
      '/admin/messages?kind=COMPLAINT&answered=no&offset=20',
    )
    expect(messagesPath({ kind: null, answered: 'yes' }, 0)).toBe('/admin/messages?answered=yes')
  })
})
