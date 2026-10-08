import { describe, expect, it } from 'vitest'

import { guestSearchWhere } from './guest-search'

const TENANT = '00000000-0000-4000-8000-00000000000a'

const clauses = (q: string | undefined): unknown[] => {
  const where = guestSearchWhere(TENANT, q)
  return 'OR' in where && Array.isArray(where.OR) ? where.OR : []
}

describe('Поиск гостя по одной строке', () => {
  it('пустая строка — без поиска, а не «ничего не найдено»', () => {
    expect(guestSearchWhere(TENANT, undefined)).toEqual({})
    expect(guestSearchWhere(TENANT, '   ')).toEqual({})
  })

  it('последние четыре цифры ищут по концу телефона', () => {
    expect(clauses('4821')).toContainEqual({ guest: { phoneE164: { endsWith: '4821' } } })
  })

  it('номер, записанный с пробелами и плюсом, всё равно ищется по цифрам', () => {
    expect(clauses('+66 81 234-4821')).toContainEqual({
      guest: { phoneE164: { endsWith: '66812344821' } },
    })
  })

  it('три цифры по телефону не ищут — это совпадение у каждого тысячного', () => {
    expect(JSON.stringify(clauses('482'))).not.toContain('phoneE164')
  })

  it('цифры проверяются и как номер чека: гость может показать чек', () => {
    expect(clauses('1042')).toContainEqual({
      ledgerEntries: { some: { refType: 'receipt', refId: '1042' } },
    })
  })

  it('промокод ищется в верхнем регистре и только среди своих подарков', () => {
    expect(clauses('k7qx-2m9p')).toContainEqual({
      guest: { offerGrants: { some: { tenantId: TENANT, code: 'K7QX-2M9P' } } },
    })
  })

  it('имя ищется по вхождению без учёта регистра, промокодом кириллица не бывает', () => {
    const found = clauses('анна')

    expect(found).toContainEqual({
      guest: { displayName: { contains: 'анна', mode: 'insensitive' } },
    })
    expect(JSON.stringify(found)).not.toContain('offerGrants')
  })
})
