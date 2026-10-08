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

  it('ТЕГ ИЗ АДРЕСА — ТОЛЬКО ИДЕНТИФИКАТОР: НАЗВАНИЕ СЕРВЕР ОТВЕРГ БЫ ЦЕЛИКОМ', () => {
    const id = '16161616-1616-4161-8161-161616161616'

    expect(filtersFromParams(new URLSearchParams(`tag=${id}`))).toEqual({ tag: id })
    expect(filtersFromParams(new URLSearchParams('tag=VIP'))).toEqual({})
    expect(filterParams({ tag: id, mode: 'TOURIST' })).toEqual([
      ['mode', 'TOURIST'],
      ['tag', id],
    ])
  })

  it('СЕГМЕНТ ИЗ ОТЧЁТА «RFM» ЧИТАЕТСЯ ИЗ АДРЕСА, НЕИЗВЕСТНЫЙ — ОТБРАСЫВАЕТСЯ', () => {
    expect(filtersFromParams(new URLSearchParams('segment=AT_RISK'))).toEqual({
      segment: 'AT_RISK',
    })
    expect(filtersFromParams(new URLSearchParams('segment=VIP'))).toEqual({})
    expect(hasFilters({ segment: 'CHAMPIONS' })).toBe(true)
  })

  it('ДЕНЬ РОЖДЕНИЯ, ПОКУПКИ, БАЛЛЫ И ТРАТЫ ЧИТАЮТСЯ ИЗ АДРЕСА, КРИВЫЕ ЧИСЛА — НЕТ', () => {
    expect(
      filtersFromParams(
        new URLSearchParams('birthday=week&visitsFrom=2&visitsTo=4&pointsTo=0&spentFrom=500000'),
      ),
    ).toEqual({ birthday: 'week', visitsFrom: 2, visitsTo: 4, pointsTo: 0, spentFrom: 500000 })

    // Ноль покупок — это «ни разу не покупали», отдельный фильтр; дробь и минус — мусор.
    expect(
      filtersFromParams(
        new URLSearchParams('birthday=year&visitsFrom=0&pointsFrom=-1&spentFrom=1.5&visitsTo='),
      ),
    ).toEqual({})
  })

  it('ПОРЯДОК В АДРЕСЕ ЖИВЁТ, НО ФИЛЬТРОМ НЕ СЧИТАЕТСЯ', () => {
    const filters = filtersFromParams(new URLSearchParams('sort=spent'))

    expect(filters).toEqual({ sort: 'spent' })
    expect(hasFilters(filters)).toBe(false)
    expect(filterParams(filters)).toEqual([['sort', 'spent']])
    // «Недавние» — порядок по умолчанию: из адреса не берётся, в запрос не идёт.
    expect(filtersFromParams(new URLSearchParams('sort=recent'))).toEqual({})
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
