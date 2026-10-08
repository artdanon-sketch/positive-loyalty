import { describe, expect, it } from 'vitest'

import { NO_GIFT, fromGiftDraft, sameGift, toGiftDraft } from './gift-draft'

/**
 * Подарок к рассылке уходит сотням гостей сразу. Лишний ноль или баллы
 * в сатангах вместо батов здесь — не опечатка, а расход заведения.
 */

describe('Черновик подарка', () => {
  it('«БЕЗ ПОДАРКА» — ЗАКОННЫЙ ВЫБОР, А НЕ ПУСТОЕ ПОЛЕ С ОШИБКОЙ', () => {
    expect(fromGiftDraft(NO_GIFT)).toEqual({ ok: true, gift: null })
  })

  it('БАЛЛЫ ВВОДЯТСЯ В БАТАХ, А УХОДЯТ В САТАНГАХ', () => {
    expect(fromGiftDraft({ kind: 'POINTS', points: '100', certificateId: '' })).toEqual({
      ok: true,
      gift: { kind: 'POINTS', amount: 10_000 },
    })
    expect(fromGiftDraft({ kind: 'POINTS', points: '12,5', certificateId: '' })).toEqual({
      ok: true,
      gift: { kind: 'POINTS', amount: 1_250 },
    })
  })

  it('НОЛЬ, МУСОР И БОЛЬШЕ ДЕСЯТИ ТЫСЯЧ БАТОВ — ОШИБКА, А НЕ ПОДАРОК', () => {
    for (const points of ['0', 'сто', '', '10000.01']) {
      expect(fromGiftDraft({ kind: 'POINTS', points, certificateId: '' })).toEqual({
        ok: false,
        problem: 'points',
      })
    }
  })

  it('СЕРТИФИКАТ НЕ ВЫБРАН — ТАК И ГОВОРИМ', () => {
    expect(fromGiftDraft({ kind: 'CERTIFICATE', points: '', certificateId: '' })).toEqual({
      ok: false,
      problem: 'certificate',
    })
  })

  it('ТУДА И ОБРАТНО — ТОТ ЖЕ ПОДАРОК: ФОРМА НЕ ГОРИТ «ЕСТЬ ИЗМЕНЕНИЯ» НА ПУСТОМ МЕСТЕ', () => {
    const points = { kind: 'POINTS' as const, amount: 5_000 }
    const back = fromGiftDraft(toGiftDraft(points))

    expect(back).toEqual({ ok: true, gift: points })
    expect(sameGift(points, { kind: 'POINTS', amount: 5_000 })).toBe(true)
    expect(sameGift(points, null)).toBe(false)
    expect(sameGift(null, null)).toBe(true)
  })
})
