import { describe, expect, it } from 'vitest'

import { AdminToday } from './today.js'

const TODAY = {
  date: '2026-09-16',
  revenue: 386_500,
  purchases: 9,
  avgCheck: 42_944,
  buyers: 8,
  newGuests: 3,
  totalGuests: 412,
  pointsEarned: 19_325,
  pointsRedeemed: 4_000,
  voided: 1,
  setup: [
    { step: 'PROGRAM', done: true },
    { step: 'CASHIER', done: true },
    { step: 'OFFER', done: false },
    { step: 'CHANNEL', done: false },
  ],
}

describe('Сегодня', () => {
  it('ОТВЕТ ЦЕЛИКОМ: ЦИФРЫ ДНЯ И ВСЕ ЧЕТЫРЕ ШАГА НАСТРОЙКИ', () => {
    expect(AdminToday.safeParse(TODAY).success).toBe(true)
    expect(AdminToday.safeParse({ ...TODAY, avgCheck: null }).success).toBe(true)
  })

  it('ШАГОВ РОВНО ЧЕТЫРЕ, НЕИЗВЕСТНЫЙ ШАГ И ДРОБНЫЕ САТАНГИ — НЕТ', () => {
    expect(AdminToday.safeParse({ ...TODAY, setup: TODAY.setup.slice(0, 3) }).success).toBe(false)
    expect(
      AdminToday.safeParse({
        ...TODAY,
        setup: [...TODAY.setup.slice(0, 3), { step: 'TELEGRAM', done: false }],
      }).success,
    ).toBe(false)
    expect(AdminToday.safeParse({ ...TODAY, revenue: 100.5 }).success).toBe(false)
  })
})
