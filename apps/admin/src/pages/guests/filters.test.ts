import { describe, expect, it } from 'vitest'

import { filterParams, filtersFromParams, hasFilters, writeFilters } from './filters'

describe('Фильтры гостей в адресе', () => {
  it('СПЯЩИЕ РЕЗИДЕНТЫ СО СТАТУСОМ «ЗОЛОТО» ЧИТАЮТСЯ ИЗ АДРЕСА И ПИШУТСЯ ОБРАТНО', () => {
    const filters = filtersFromParams(
      new URLSearchParams('mode=RESIDENT&tier=gold&sleeping=30&buyers=none&source=STAFF'),
    )

    expect(filters).toEqual({
      mode: 'RESIDENT',
      tier: 'gold',
      sleeping: 30,
      buyers: 'none',
      source: 'STAFF',
    })

    const params = new URLSearchParams('q=4821&guest=abc&mode=TOURIST')
    writeFilters(params, { tier: 'gold', sleeping: 60 })

    // Поиск и открытая карточка остались, снятый фильтр ушёл.
    expect(params.toString()).toBe('q=4821&guest=abc&tier=gold&sleeping=60')
  })

  it('НЕИЗВЕСТНОЕ ИЗ АДРЕСА ОТБРАСЫВАЕТСЯ: СПИСОК БЕЗ ФИЛЬТРА ЛУЧШЕ ПУСТОГО ЭКРАНА', () => {
    expect(
      filtersFromParams(
        new URLSearchParams('mode=ALIEN&tier=Gold%20VIP&sleeping=3&buyers=all&source=MAGIC'),
      ),
    ).toEqual({})
    expect(filtersFromParams(new URLSearchParams('sleeping=366'))).toEqual({})
    expect(filtersFromParams(new URLSearchParams('sleeping=45'))).toEqual({ sleeping: 45 })
  })

  it('запрос к серверу — в постоянном порядке, как бы ни кликали', () => {
    expect(filterParams({ buyers: 'none', mode: 'TOURIST' })).toEqual([
      ['mode', 'TOURIST'],
      ['buyers', 'none'],
    ])
    expect(hasFilters({})).toBe(false)
    expect(hasFilters({ source: 'ORGANIC' })).toBe(true)
  })
})
