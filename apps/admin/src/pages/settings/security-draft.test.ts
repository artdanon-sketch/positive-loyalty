import { describe, expect, it } from 'vitest'

import { parseThreshold } from './security-draft'

describe('Порог подозрительных чеков', () => {
  it('ЦЕЛОЕ ОТ 2 ДО 50, ПРОБЕЛЫ ПО КРАЯМ НЕ МЕШАЮТ', () => {
    expect(parseThreshold(' 5 ')).toBe(5)
    expect(parseThreshold('2')).toBe(2)
    expect(parseThreshold('50')).toBe(50)
  })

  it('ЕДИНИЦА, ПЯТЬДЕСЯТ ОДИН, ДРОБЬ И ПУСТО — НЕЛЬЗЯ', () => {
    expect(parseThreshold('1')).toBeNull()
    expect(parseThreshold('51')).toBeNull()
    expect(parseThreshold('4.5')).toBeNull()
    expect(parseThreshold('')).toBeNull()
  })
})
