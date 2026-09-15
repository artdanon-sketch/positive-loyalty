import { describe, expect, it } from 'vitest'

import { AdjustPointsInput, GuestNoteInput } from './guest-actions.js'

describe('Баллы вручную: контракт', () => {
  it('начислить и списать — со знаком и с причиной', () => {
    expect(
      AdjustPointsInput.safeParse({ amount: 5_000, reason: 'Компенсация за долгое ожидание' })
        .success,
    ).toBe(true)
    expect(
      AdjustPointsInput.safeParse({ amount: -2_000, reason: 'Ошибочно начислили вчера' }).success,
    ).toBe(true)
  })

  it('ПРАВКА НА НОЛЬ, ДРОБНАЯ И СВЫШЕ 100 000 ฿ — ОТКАЗ', () => {
    const reason = 'Компенсация за долгое ожидание'

    expect(AdjustPointsInput.safeParse({ amount: 0, reason }).success).toBe(false)
    expect(AdjustPointsInput.safeParse({ amount: 50.5, reason }).success).toBe(false)
    expect(AdjustPointsInput.safeParse({ amount: 10_000_001, reason }).success).toBe(false)
    expect(AdjustPointsInput.safeParse({ amount: -10_000_001, reason }).success).toBe(false)
  })

  it('БЕЗ ПРИЧИНЫ НЕ ПРОХОДИТ: ЧЕРЕЗ МЕСЯЦ СТРОКУ В ЖУРНАЛЕ НЕЧЕМ БУДЕТ ОБЪЯСНИТЬ', () => {
    expect(AdjustPointsInput.safeParse({ amount: 5_000, reason: 'надо' }).success).toBe(false)
    expect(AdjustPointsInput.safeParse({ amount: 5_000 }).success).toBe(false)
    expect(
      AdjustPointsInput.safeParse({
        amount: 5_000,
        reason: 'Компенсация за долгое ожидание',
        membershipId: 'чужой',
      }).success,
    ).toBe(false)
  })
})

describe('Заметка о госте: контракт', () => {
  it('до 1000 знаков; пустая — стереть', () => {
    expect(GuestNoteInput.safeParse({ text: 'Аллергия на арахис' }).success).toBe(true)
    expect(GuestNoteInput.parse({ text: '   ' })).toEqual({ text: '' })
    expect(GuestNoteInput.safeParse({ text: 'я'.repeat(1000) }).success).toBe(true)
    expect(GuestNoteInput.safeParse({ text: 'я'.repeat(1001) }).success).toBe(false)
  })
})
