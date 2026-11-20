import { describe, expect, it } from 'vitest'

import { IssuePosGrantInput } from './pos-grant.js'

const base = {
  phone: '+66812345678',
  code: 'ira20',
  title: '−20% на заказ',
  expiresAt: '2026-12-31T23:59:59+07:00',
}

describe('Промокод POSitive: запрос выдачи', () => {
  it('код приводится к верхнему регистру — гость набирает как угодно', () => {
    expect(IssuePosGrantInput.parse(base).code).toBe('IRA20')
  })

  it('дефис и подчёркивание внутри — как в POSitive', () => {
    expect(IssuePosGrantInput.parse({ ...base, code: 'new_year-25' }).code).toBe('NEW_YEAR-25')
  })

  it('кириллица, дефис и лишние поля — отказ', () => {
    expect(IssuePosGrantInput.safeParse({ ...base, code: 'ИРА20' }).success).toBe(false)
    expect(IssuePosGrantInput.safeParse({ ...base, code: '-IRA20' }).success).toBe(false)
    expect(IssuePosGrantInput.safeParse({ ...base, code: 'IRA 20' }).success).toBe(false)
    expect(IssuePosGrantInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })

  it('телефон только в E.164', () => {
    expect(IssuePosGrantInput.safeParse({ ...base, phone: '0812345678' }).success).toBe(false)
  })
})
