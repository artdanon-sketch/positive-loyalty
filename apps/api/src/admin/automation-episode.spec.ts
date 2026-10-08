import { describe, expect, it } from 'vitest'

import { episodeOf } from './automation-episode'

/**
 * Ошибка здесь стоит денег: неверный эпизод — это подарок каждый день одному
 * и тому же гостю или ни одного письма тому, кто снова уснул.
 */

const visit = new Date('2026-09-01T12:00:00.000Z')
const later = new Date('2026-09-20T12:00:00.000Z')

describe('Эпизод автосценария', () => {
  it('СПЯЩИЙ: ТОТ ЖЕ ПОСЛЕДНИЙ ВИЗИТ — ТОТ ЖЕ ЭПИЗОД, ВТОРОГО ПИСЬМА НЕТ', () => {
    expect(episodeOf('SLEEPING', 30, visit)).toBe(episodeOf('SLEEPING', 30, visit))
  })

  it('СПЯЩИЙ ПРИШЁЛ И СНОВА УСНУЛ — НОВЫЙ ЭПИЗОД', () => {
    expect(episodeOf('SLEEPING', 30, later)).not.toBe(episodeOf('SLEEPING', 30, visit))
  })

  it('ПОРОГ СПЯЩИХ НЕ ДЕЛАЕТ ЭПИЗОД НОВЫМ: ВЛАДЕЛЕЦ ПОДВИНУЛ ДНИ — ГОСТЬ ТОТ ЖЕ', () => {
    expect(episodeOf('SLEEPING', 45, visit)).toBe(episodeOf('SLEEPING', 30, visit))
  })

  it('«ВСТУПИЛ, НО НЕ КУПИЛ» — ОДИН РАЗ НАВСЕГДА', () => {
    expect(episodeOf('JOINED_NO_PURCHASE', 7, null)).toBe(
      episodeOf('JOINED_NO_PURCHASE', 14, visit),
    )
  })

  it('«СУММА ПОКУПОК» — НОВЫЙ ЭПИЗОД, ТОЛЬКО КОГДА ПОДНЯЛИ ПОРОГ', () => {
    expect(episodeOf('SPENT_TOTAL', 1_000_000, visit)).toBe(
      episodeOf('SPENT_TOTAL', 1_000_000, later),
    )
    expect(episodeOf('SPENT_TOTAL', 5_000_000, visit)).not.toBe(
      episodeOf('SPENT_TOTAL', 1_000_000, visit),
    )
  })
})
