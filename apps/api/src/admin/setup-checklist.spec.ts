import { describe, expect, it } from 'vitest'

import { setupChecklist } from './setup-checklist'

const NOTHING = { settings: {}, cashiers: 0, offers: 0, channels: 0 }

describe('Чеклист настройки', () => {
  it('НОВОЕ ЗАВЕДЕНИЕ: ВСЕ ЧЕТЫРЕ ШАГА НЕ СДЕЛАНЫ, ПОРЯДОК — ПОРЯДОК ШАГОВ', () => {
    expect(setupChecklist(NOTHING)).toEqual([
      { step: 'PROGRAM', done: false },
      { step: 'CASHIER', done: false },
      { step: 'OFFER', done: false },
      { step: 'CHANNEL', done: false },
    ])
  })

  it('ПРОГРАММА СДЕЛАНА, КОГДА ВЛАДЕЛЕЦ СОХРАНИЛ ПРОЦЕНТ НАЧИСЛЕНИЯ', () => {
    const done = (settings: unknown): boolean =>
      setupChecklist({ ...NOTHING, settings })[0]?.done ?? false

    expect(done({ baseEarnRate: 5 })).toBe(true)
    expect(done({ tiers: [] })).toBe(false)
    expect(done(null)).toBe(false)
    expect(done(['baseEarnRate'])).toBe(false)
  })

  it('кассир, акция и источник — по одному достаточно', () => {
    expect(
      setupChecklist({ settings: { baseEarnRate: 5 }, cashiers: 1, offers: 2, channels: 1 }).every(
        (item) => item.done,
      ),
    ).toBe(true)
    expect(setupChecklist({ ...NOTHING, offers: 1 }).map((item) => item.done)).toEqual([
      false,
      false,
      true,
      false,
    ])
  })
})
