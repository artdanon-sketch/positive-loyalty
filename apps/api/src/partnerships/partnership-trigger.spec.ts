import { describe, expect, it } from 'vitest'

import { idempotencyKey, matches, type TriggerEvent } from './partnership-trigger.service'

/**
 * Совпадение триггера с событием — чистая арифметика, без базы.
 *
 * Вынесено отдельной функцией именно ради этого: перебрать все виды триггеров
 * и все границы можно за миллисекунды, не поднимая ни Postgres, ни Nest.
 * Интеграционный тест проверяет лимиты и повторы — то, что живёт в базе.
 */

const event = (over: Partial<TriggerEvent> = {}): TriggerEvent => ({
  tenantId: 'studio',
  guestId: 'anna',
  sourceEntryId: 'entry-1',
  refType: 'receipt',
  basisAmount: 100_000,
  visitsTotal: 1,
  membershipCreated: false,
  occurredAt: new Date('2026-09-10T10:00:00.000Z'),
  ...over,
})

describe('Совпадение триггера партнёрства', () => {
  describe('ON_PURCHASE', () => {
    const trigger = { type: 'ON_PURCHASE', minAmount: 100_000 } as const

    it('срабатывает ровно на пороге', () => {
      expect(matches(trigger, event({ basisAmount: 100_000 }))).toBe(true)
    })

    it('не срабатывает на сатанг ниже порога', () => {
      // Граница проверяется отдельно: «больше или равно» легко превратить
      // в «строго больше» при правке, и заметить это по журналу невозможно.
      expect(matches(trigger, event({ basisAmount: 99_999 }))).toBe(false)
    })

    it('НЕ СРАБАТЫВАЕТ НА АБОНЕМЕНТЕ', () => {
      // У абонемента своё условие. Смешать их — значит выдать гостю два
      // подарка за одну продажу: один по ON_PURCHASE, другой по пакету.
      expect(matches(trigger, event({ refType: 'package', basisAmount: 500_000 }))).toBe(false)
    })

    it('не срабатывает без суммы', () => {
      expect(matches(trigger, event({ basisAmount: null }))).toBe(false)
    })
  })

  describe('ON_PACKAGE_PURCHASE', () => {
    const trigger = { type: 'ON_PACKAGE_PURCHASE', minAmount: 500_000 } as const

    it('срабатывает на абонементе от порога — пример из ТЗ', () => {
      // «Клиент купил абонемент на 5 000 ฿» — docs/07, раздел 4.3.
      expect(matches(trigger, event({ refType: 'package', basisAmount: 500_000 }))).toBe(true)
    })

    it('не срабатывает на обычном чеке той же суммы', () => {
      expect(matches(trigger, event({ refType: 'receipt', basisAmount: 500_000 }))).toBe(false)
    })
  })

  describe('визиты', () => {
    it('ON_FIRST_VISIT — только первый', () => {
      expect(matches({ type: 'ON_FIRST_VISIT' }, event({ visitsTotal: 1 }))).toBe(true)
      expect(matches({ type: 'ON_FIRST_VISIT' }, event({ visitsTotal: 2 }))).toBe(false)
    })

    it('ON_NTH_VISIT — ровно N-й, не «N-й и дальше»', () => {
      const trigger = { type: 'ON_NTH_VISIT', n: 3 } as const

      expect(matches(trigger, event({ visitsTotal: 2 }))).toBe(false)
      expect(matches(trigger, event({ visitsTotal: 3 }))).toBe(true)
      // Иначе гость получал бы подарок на каждом визите после третьего.
      expect(matches(trigger, event({ visitsTotal: 4 }))).toBe(false)
    })

    it('без счётчика визитов не срабатывает', () => {
      expect(matches({ type: 'ON_FIRST_VISIT' }, event({ visitsTotal: null }))).toBe(false)
    })
  })

  it('ON_MEMBERSHIP — только когда участие создано этим событием', () => {
    expect(matches({ type: 'ON_MEMBERSHIP' }, event({ membershipCreated: true }))).toBe(true)
    expect(matches({ type: 'ON_MEMBERSHIP' }, event({ membershipCreated: false }))).toBe(false)
  })

  it('ТРИГГЕРЫ БЕЗ МЕХАНИКИ НЕ СРАБАТЫВАЮТ, а не срабатывают всегда', () => {
    // Штампов и статусов в системе пока нет. Договориться о таком условии
    // можно, но выдавать по нему нечего. «Не совпало» — честно; «совпало»
    // раздавало бы подарки на каждой покупке.
    expect(matches({ type: 'ON_STAMP_COMPLETE' }, event())).toBe(false)
    expect(matches({ type: 'ON_TIER_REACHED', tierId: 'gold' }, event())).toBe(false)
  })
})

describe('Ключ идемпотентности', () => {
  it('одинаков для одного и того же события', () => {
    expect(idempotencyKey('term', 'anna', 'entry')).toBe(idempotencyKey('term', 'anna', 'entry'))
  })

  it('РАЗЛИЧАЕТ ПО КАЖДОЙ ИЗ ТРЁХ СОСТАВЛЯЮЩИХ', () => {
    const base = idempotencyKey('term', 'anna', 'entry')

    // Без записи журнала гость получил бы подарок один раз за всю жизнь
    // партнёрства; без гостя — один раз на всех; без условия — путались бы
    // разные условия одного партнёрства.
    expect(idempotencyKey('other', 'anna', 'entry')).not.toBe(base)
    expect(idempotencyKey('term', 'boris', 'entry')).not.toBe(base)
    expect(idempotencyKey('term', 'anna', 'entry-2')).not.toBe(base)
  })

  it('не склеивается на границах составляющих', () => {
    // «ab|c» и «a|bc» не должны давать один ключ: иначе подобранными
    // идентификаторами можно было бы выдать себе чужой подарок.
    expect(idempotencyKey('ab', 'c', 'd')).not.toBe(idempotencyKey('a', 'bc', 'd'))
  })
})
