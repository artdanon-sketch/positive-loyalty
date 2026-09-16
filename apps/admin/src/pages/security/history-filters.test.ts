import { describe, expect, it } from 'vitest'

import { historyPath, isFiltered, NO_HISTORY_FILTERS } from './history-filters'

describe('Фильтры истории действий', () => {
  it('БЕЗ ФИЛЬТРОВ И БЕЗ ЛИСТАНИЯ — ЧИСТЫЙ АДРЕС', () => {
    expect(historyPath(NO_HISTORY_FILTERS, null)).toBe('/admin/security/history')
    expect(isFiltered(NO_HISTORY_FILTERS)).toBe(false)
  })

  it('ДЕНЬ, СОТРУДНИК И ЛИСТАНИЕ СКЛАДЫВАЮТСЯ В ОДИН ЗАПРОС', () => {
    const path = historyPath(
      { day: '2026-09-16', actorId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
      '2026-09-16T09:12:40.118Z',
    )

    expect(path).toBe(
      '/admin/security/history?before=2026-09-16T09%3A12%3A40.118Z&day=2026-09-16' +
        '&actorId=7c9e6679-7425-40de-944b-e07fc1f90ae7',
    )
    expect(isFiltered({ day: null, actorId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })).toBe(true)
  })
})
