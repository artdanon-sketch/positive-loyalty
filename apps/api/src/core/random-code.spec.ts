import { REFERRAL_CODE_LENGTH, ReferralCode } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { CODE_ALPHABET, isUniqueViolation, randomCode } from './random-code'

describe('Коды, которые набирают руками', () => {
  it('КОД ПРИГЛАШЕНИЯ ИЗ ГЕНЕРАТОРА ПРОХОДИТ КОНТРАКТ: ВОСЕМЬ ЗНАКОВ БЕЗ 0, O, 1, I И L', () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/)

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = randomCode(REFERRAL_CODE_LENGTH)

      expect(ReferralCode.safeParse(code).success).toBe(true)
    }
  })

  it('длина — ровно заданная, и коды не повторяются', () => {
    const codes = new Set(Array.from({ length: 50 }, () => randomCode(12)))

    expect([...codes].every((code) => code.length === 12)).toBe(true)
    expect(codes.size).toBe(50)
  })

  it('нарушение уникальности узнаётся и по коду Prisma, и по коду Postgres', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true)
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true)
    expect(isUniqueViolation(new Error('connection lost'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
