import { describe, expect, it } from 'vitest'

import { formatDay, tickStep } from './day'

describe('Подписи дней на графиках', () => {
  it('ДАТА ПОД СТОЛБЦОМ — ДЕНЬ И МЕСЯЦ, БЕЗ ГОДА', () => {
    expect(formatDay('2026-08-27')).toBe('27.08')
  })

  it('неделя подписывается целиком, месяц — через два дня на третий, квартал — через десять', () => {
    expect([7, 10, 30, 31, 90].map(tickStep)).toEqual([1, 1, 3, 3, 10])
  })
})
