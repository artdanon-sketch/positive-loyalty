import { describe, expect, it } from 'vitest'

import { guestFilterWhere } from './guest-search'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const TENANT = '11111111-1111-4111-8111-111111111111'

describe('Фильтры списка гостей', () => {
  it('без фильтров — только поиск, а пустой поиск ничего не сужает', () => {
    expect(guestFilterWhere(TENANT, {}, NOW)).toEqual({ AND: [{}] })
  })

  it('ФИЛЬТРЫ СКЛАДЫВАЮТСЯ ЧЕРЕЗ «И»: СПЯЩИЕ РЕЗИДЕНТЫ СО СТАТУСОМ «ЗОЛОТО»', () => {
    expect(guestFilterWhere(TENANT, { mode: 'RESIDENT', tier: 'gold', sleeping: 30 }, NOW)).toEqual(
      {
        AND: [
          {},
          { guest: { mode: 'RESIDENT' } },
          { tierId: 'gold' },
          { lastVisitAt: { not: null, lt: new Date('2026-08-16T12:00:00.000Z') } },
        ],
      },
    )
  })

  it('СПЯЩИЙ — ТОТ, КТО БЫЛ; ГОСТЬ БЕЗ ВИЗИТОВ НЕ СПИТ — ДЛЯ НЕГО «НЕ ПОКУПАЛИ»', () => {
    const sleeping = guestFilterWhere(TENANT, { sleeping: 7 }, NOW)
    const never = guestFilterWhere(TENANT, { buyers: 'none', source: 'STAFF' }, NOW)

    expect(sleeping.AND).toContainEqual({
      lastVisitAt: { not: null, lt: new Date('2026-09-08T12:00:00.000Z') },
    })
    expect(never).toEqual({ AND: [{}, { source: 'STAFF' }, { visitsTotal: 0 }] })
  })

  it('поиск остаётся внутри фильтров, а не рядом с ними', () => {
    const where = guestFilterWhere(TENANT, { q: 'Анна', mode: 'TOURIST' }, NOW)

    expect(where.AND).toHaveLength(2)
    expect(Array.isArray(where.AND) && where.AND[0]).toHaveProperty('OR')
  })
})
