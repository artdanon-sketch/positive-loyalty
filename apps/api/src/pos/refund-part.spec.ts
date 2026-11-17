import { describe, expect, it } from 'vitest'

import { partOfEarned } from './pos.service'

describe('partOfEarned — сколько начисленного снять при частичном возврате', () => {
  it('половина денег — половина начисленного, к ближайшему', () => {
    expect(partOfEarned(4500, 90_000, 45_000)).toBe(2250)
    expect(partOfEarned(3, 100, 50)).toBe(2)
  })

  it('не больше начисленного, даже если касса прислала больше суммы чека', () => {
    expect(partOfEarned(4500, 90_000, 120_000)).toBe(4500)
  })

  it('ноль начислено, ноль денег или пустая база — снимать нечего', () => {
    expect(partOfEarned(0, 90_000, 45_000)).toBe(0)
    expect(partOfEarned(4500, 90_000, 0)).toBe(0)
    expect(partOfEarned(4500, 0, 45_000)).toBe(0)
  })

  it('большие суммы не теряют точность (сатанги × баллы > 2^53)', () => {
    expect(partOfEarned(2_000_000_000, 2_000_000_000, 1_000_000_001)).toBe(1_000_000_001)
  })
})
