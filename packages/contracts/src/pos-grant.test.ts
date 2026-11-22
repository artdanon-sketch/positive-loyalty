import { describe, expect, it } from 'vitest'

import { PosGrantCode, PutPosGrantInput } from './pos-grant.js'

const base = {
  phone: '+66812345678',
  title: '−20% на заказ',
  expiresAt: '2026-12-31T23:59:59+07:00',
}

describe('Промокод POSitive: код в пути', () => {
  it('приводится к верхнему регистру — гость набирает как угодно', () => {
    expect(PosGrantCode.parse('ira20')).toBe('IRA20')
  })

  it('дефис и подчёркивание внутри — как в POSitive', () => {
    expect(PosGrantCode.parse('new_year-25')).toBe('NEW_YEAR-25')
  })

  it('кириллица, пробел, дефис в начале, слишком коротко — отказ', () => {
    for (const bad of ['ИРА20', 'IRA 20', '-IRA20', 'AB']) {
      expect(PosGrantCode.safeParse(bad).success).toBe(false)
    }
  })
})

describe('Промокод POSitive: тело запроса', () => {
  it('лишние поля — отказ', () => {
    expect(PutPosGrantInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })

  it('телефон только в E.164', () => {
    expect(PutPosGrantInput.safeParse({ ...base, phone: '0812345678' }).success).toBe(false)
  })
})
