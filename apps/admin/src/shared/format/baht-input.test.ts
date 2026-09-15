import { describe, expect, it } from 'vitest'

import { bahtToMinor } from './baht-input'

describe('Сумма в батах из поля ввода', () => {
  it('БАТЫ СТАНОВЯТСЯ САТАНГАМИ: «150» — ЭТО 15 000, А НЕ 150', () => {
    expect(bahtToMinor('150')).toBe(15_000)
    expect(bahtToMinor(' 799,5 ')).toBe(79_950)
    expect(bahtToMinor('19.99')).toBe(1_999)
    expect(bahtToMinor('0.01')).toBe(1)
  })

  it('ноль, минус, лишние знаки после запятой и мусор — не сумма', () => {
    for (const value of ['', '0', '0,00', '-5', '1.234', '12abc', '1e3', '12345678']) {
      expect(bahtToMinor(value)).toBeNull()
    }
  })
})
