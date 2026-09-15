import { describe, expect, it } from 'vitest'

import { simulateOffer } from './simulate'
import type { HistoryCheck, SimulatedOffer } from './simulate'

/**
 * Прогноз на своей истории. Сейчас — 15 сентября 2026, 19:00 по Пхукету.
 * Чеки по умолчанию — в 12:00 по Пхукету (05:00 UTC).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-15T12:00:00.000Z')
const LONG_AGO = new Date(NOW.getTime() - 90 * DAY_MS)

const check = (
  guestId: string,
  amount: number,
  daysAgo: number,
  overrides: Partial<HistoryCheck> = {},
): HistoryCheck => {
  const at = new Date(NOW.getTime() - daysAgo * DAY_MS)
  at.setUTCHours(5, 0, 0, 0)

  return {
    guestId,
    amount,
    at,
    mode: 'TOURIST',
    isControlGroup: false,
    isFirstVisit: false,
    previousVisitAt: null,
    ...overrides,
  }
}

/** Двадцать мелких чеков от разных гостей: история есть, порог не пройден. */
const background = (): HistoryCheck[] =>
  Array.from({ length: 20 }, (_, index) =>
    check(`small-${String(index)}`, 30_000, 1 + (index % 25)),
  )

const RETURN_TOMORROW: SimulatedOffer = {
  type: 'PROMO_ON_CHECK',
  audience: { kind: 'ALL' },
  schedule: {},
  limits: { minCheck: 80_000, perGuestQty: 1 },
  reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 20_000 }, validityDays: 1 },
}

const run = (
  offer: SimulatedOffer,
  checks: HistoryCheck[],
  historyStartedAt: Date | null = LONG_AGO,
) => simulateOffer({ offer, checks, historyStartedAt, now: NOW, timezone: 'Asia/Bangkok' })

describe('Прогноз: когда данных мало', () => {
  it('ЗАВЕДЕНИЕ В ПРОГРАММЕ МЕНЬШЕ 30 ДНЕЙ — ЦИФР НЕТ, ЕСТЬ ПРИЧИНА', () => {
    expect(run(RETURN_TOMORROW, background(), new Date(NOW.getTime() - 10 * DAY_MS))).toEqual({
      insufficientData: true,
      reason: 'Заведение в программе меньше 30 дней — прогноз по неполной истории соврал бы',
    })
    expect(run(RETURN_TOMORROW, [], null).insufficientData).toBe(true)
  })

  it('меньше двадцати чеков за окно — прогноз случаен и не показывается', () => {
    const outcome = run(RETURN_TOMORROW, background().slice(0, 19))

    expect(outcome).toMatchObject({ insufficientData: true })
  })

  it('чеки старше тридцати дней в окно не входят', () => {
    const old = Array.from({ length: 20 }, (_, index) => check(`old-${String(index)}`, 90_000, 40))

    expect(run(RETURN_TOMORROW, [...old, ...background().slice(0, 5)]).insufficientData).toBe(true)
  })
})

describe('Прогноз: промокод за чек', () => {
  it('ПОРОГ И ЛИМИТ НА ГОСТЯ — ТЕ ЖЕ, ЧТО НА КАССЕ: ДВА ГОСТЯ, ДВА КОДА, 400 ฿ ЕСЛИ ПОГАСЯТ ВСЕ', () => {
    const outcome = run(RETURN_TOMORROW, [
      ...background(),
      check('anna', 90_000, 3),
      check('anna', 95_000, 2),
      check('anna', 99_000, 1),
      check('boris', 80_000, 4),
    ])

    expect(outcome).toEqual({
      insufficientData: false,
      days: 30,
      guests: 2,
      grants: 2,
      bonusPoints: null,
      cost: 40_000,
    })
  })

  it('общий лимит обрывает выдачу', () => {
    const outcome = run({ ...RETURN_TOMORROW, limits: { minCheck: 80_000, totalQty: 1 } }, [
      ...background(),
      check('anna', 90_000, 3),
      check('boris', 90_000, 2),
    ])

    expect(outcome).toMatchObject({ guests: 1, grants: 1, cost: 20_000 })
  })

  it('ДАТЫ АКЦИИ НЕ ОБНУЛЯЮТ ПРОГНОЗ: «НА ЗАВТРА» СЧИТАЕТСЯ ПО ПРОШЛЫМ ДНЯМ', () => {
    const tomorrow = {
      ...RETURN_TOMORROW,
      schedule: { startsAt: '2026-09-16T00:00:00+07:00', endsAt: '2026-09-16T23:59:00+07:00' },
    }

    expect(run(tomorrow, [...background(), check('anna', 90_000, 3)])).toMatchObject({ grants: 1 })
  })

  it('окно времени — условие, и оно учитывается по часам заведения', () => {
    const quiet = { ...RETURN_TOMORROW, schedule: { timeWindow: { from: '14:00', to: '17:00' } } }
    const lunch = check('anna', 90_000, 3)
    const afternoon = check('boris', 90_000, 3, {
      at: new Date(NOW.getTime() - 3 * DAY_MS - 3 * 60 * 60 * 1000),
    })

    expect(run(quiet, [...background(), lunch, afternoon])).toMatchObject({ guests: 1, grants: 1 })
  })

  it('подарок вещью или процентом — цену знает только заведение', () => {
    const dessert: SimulatedOffer = {
      ...RETURN_TOMORROW,
      reward: {
        kind: 'GIFT_CODE',
        gift: { kind: 'FREE_ITEM', itemName: 'Десерт' },
        validityDays: 3,
      },
    }

    expect(run(dessert, [...background(), check('anna', 90_000, 3)])).toMatchObject({
      grants: 1,
      cost: null,
    })
  })

  it('контрольная группа в прогнозе акций не получает — как и на кассе', () => {
    const outcome = run(RETURN_TOMORROW, [
      ...background(),
      check('control', 90_000, 3, { isControlGroup: true }),
    ])

    expect(outcome).toMatchObject({ guests: 0, grants: 0, cost: 0 })
  })
})

describe('Прогноз: кэшбэк', () => {
  it('КЭШБЭК 10%: БАЛЛЫ СВЕРХ СТАВКИ И ЕСТЬ ЕГО ЦЕНА', () => {
    const outcome = run(
      {
        type: 'CASHBACK',
        audience: { kind: 'ALL' },
        schedule: {},
        limits: { minCheck: 80_000 },
        reward: { kind: 'EARN_PERCENT', percent: 10 },
      },
      [...background(), check('anna', 90_000, 3), check('anna', 100_001, 1)],
    )

    expect(outcome).toEqual({
      insufficientData: false,
      days: 30,
      guests: 1,
      grants: null,
      bonusPoints: 19_000,
      cost: 19_000,
    })
  })
})
