import { describe, expect, it } from 'vitest'

import { decodeRange, encodeRange, POINT_RANGES, VISIT_RANGES } from './filter-ranges'

describe('Диапазоны фильтров гостей', () => {
  it('ГРАНИЦЫ ТУДА И ОБРАТНО — БЕЗ ПОТЕРЬ, ОТКРЫТАЯ СТОРОНА ОСТАЁТСЯ ОТКРЫТОЙ', () => {
    for (const range of [...VISIT_RANGES, ...POINT_RANGES]) {
      expect(decodeRange(encodeRange(range))).toEqual(range)
    }

    expect(encodeRange({ from: 5, to: undefined })).toBe('5:')
    expect(encodeRange({ from: undefined, to: 0 })).toBe(':0')
  })

  it('ОБЕ ГРАНИЦЫ ПУСТЫ — ФИЛЬТР СНЯТ, А МУСОР НЕ СТАНОВИТСЯ ФИЛЬТРОМ', () => {
    expect(encodeRange({ from: undefined, to: undefined })).toBe('')
    expect(decodeRange('')).toEqual({ from: undefined, to: undefined })
    expect(decodeRange('пять:')).toEqual({ from: undefined, to: undefined })
  })
})
