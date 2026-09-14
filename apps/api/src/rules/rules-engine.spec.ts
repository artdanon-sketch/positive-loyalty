import { describe, expect, it } from 'vitest'

import { evaluateOffers } from './rules-engine'
import type { OfferCandidate, RuleContext } from './rules-engine'

/**
 * Движок правил на границах. docs/01, раздел 4.5.
 *
 * Время — пятница 18 сентября 2026, 16:30 по Пхукету (09:30 UTC).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const AT = new Date('2026-09-18T09:30:00.000Z')

const context = (overrides: Partial<RuleContext> = {}): RuleContext => ({
  amount: 90_000,
  amountToPay: 90_000,
  at: AT,
  timezone: 'Asia/Bangkok',
  guest: { isNew: false, mode: 'TOURIST', lastVisitAt: null, isControlGroup: false },
  ...overrides,
})

let sequence = 0

const offer = (overrides: Partial<OfferCandidate> = {}): OfferCandidate => {
  sequence += 1

  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    type: 'PROMO_ON_CHECK',
    priority: 100,
    stackable: true,
    title: 'Вернём 200 ฿',
    audience: { kind: 'ALL' },
    schedule: {},
    limits: { minCheck: 80_000, perGuestQty: 1 },
    reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 20_000 }, validityDays: 1 },
    issued: { total: 0, toGuest: 0 },
    ...overrides,
  }
}

const cashback = (percent: number, overrides: Partial<OfferCandidate> = {}): OfferCandidate =>
  offer({
    type: 'CASHBACK',
    title: `Кэшбэк ${String(percent)}%`,
    limits: {},
    reward: { kind: 'EARN_PERCENT', percent },
    ...overrides,
  })

describe('Механики', () => {
  it('ПРОМОКОД ЗА ЧЕК 900 ฿ ПРИ ПОРОГЕ 800 ฿ — ВЫДАСТСЯ ПОСЛЕ ОПЛАТЫ, ЖИВЁТ СУТКИ', () => {
    const promo = offer()
    const outcome = evaluateOffers([promo], context())

    expect(outcome.applied).toEqual([
      {
        offerId: promo.id,
        title: 'Вернём 200 ฿',
        earnDelta: 0,
        discountDelta: 0,
        grantAfterPayment: true,
        grantValidityDays: 1,
      },
    ])
    expect(outcome.skipped).toEqual([])
    expect(outcome.earnDelta).toBe(0)
  })

  it('порог чека: ровно 800 ฿ — да, 799.99 ฿ — нет, с объяснением в деньгах', () => {
    expect(evaluateOffers([offer()], context({ amount: 80_000 })).applied).toHaveLength(1)

    const short = evaluateOffers([offer()], context({ amount: 79_999, amountToPay: 79_999 }))
    expect(short.applied).toEqual([])
    expect(short.skipped[0]).toMatchObject({
      reason: 'MIN_CHECK',
      message: 'Нужен чек от 800 ฿ — сейчас 799.99 ฿',
    })
  })

  it('КЭШБЭК — ОТ ОПЛАЧЕННОГО ДЕНЬГАМИ, А НЕ ОТ ЧЕКА: БАЛЛЫ ПРОЦЕНТОВ НЕ ПРИНОСЯТ', () => {
    const outcome = evaluateOffers([cashback(10)], context({ amount: 90_000, amountToPay: 70_001 }))

    expect(outcome.applied[0]).toMatchObject({ earnDelta: 7_000, grantAfterPayment: false })
    expect(outcome.earnDelta).toBe(7_000)
  })

  it('кэшбэк лимитами промокодов не ограничен — он кодов не выдаёт', () => {
    const outcome = evaluateOffers(
      [cashback(5, { limits: { perGuestQty: 1 }, issued: { total: 99, toGuest: 9 } })],
      context(),
    )

    expect(outcome.applied).toHaveLength(1)
  })
})

describe('Приоритет и стекирование', () => {
  it('НЕСТЕКИРУЕМАЯ ОБРЫВАЕТ ЦЕПОЧКУ: ВСЁ НИЖЕ — «НЕ СУММИРУЕТСЯ»', () => {
    const first = cashback(10, { priority: 10, stackable: false })
    const second = offer({ priority: 20 })
    const outcome = evaluateOffers([second, first], context())

    expect(outcome.applied.map((item) => item.offerId)).toEqual([first.id])
    expect(outcome.skipped).toEqual([
      {
        offerId: second.id,
        title: 'Вернём 200 ฿',
        reason: 'NOT_STACKABLE',
        message: 'Не суммируется с акцией выше',
      },
    ])
  })

  it('стекируемые складываются; нестекируемая после них ложится и закрывает цепочку', () => {
    const a = cashback(5, { priority: 1 })
    const b = cashback(3, { priority: 2, stackable: false })
    const c = cashback(2, { priority: 3 })
    const outcome = evaluateOffers([c, b, a], context({ amountToPay: 100_000 }))

    expect(outcome.applied.map((item) => item.offerId)).toEqual([a.id, b.id])
    expect(outcome.skipped.map((item) => [item.offerId, item.reason])).toEqual([
      [c.id, 'NOT_STACKABLE'],
    ])
    expect(outcome.earnDelta).toBe(8_000)
  })

  it('НЕ ПРИМЕНИВШАЯСЯ НЕСТЕКИРУЕМАЯ ЦЕПОЧКУ НЕ ОБРЫВАЕТ', () => {
    const blocked = offer({ priority: 1, stackable: false, limits: { minCheck: 500_000 } })
    const next = cashback(10, { priority: 2 })
    const outcome = evaluateOffers([blocked, next], context())

    expect(outcome.applied.map((item) => item.offerId)).toEqual([next.id])
    expect(outcome.skipped.map((item) => item.reason)).toEqual(['MIN_CHECK'])
  })
})

describe('Когда: по часам заведения', () => {
  it('В ПЯТНИЦУ 20:00 UTC НА ПХУКЕТЕ УЖЕ СУББОТА — БУДНИЧНАЯ АКЦИЯ НЕ ДЕЙСТВУЕТ', () => {
    const weekdays = offer({ schedule: { weekdays: [1, 2, 3, 4, 5] } })
    const lateFriday = new Date('2026-09-18T20:00:00.000Z')

    expect(evaluateOffers([weekdays], context()).applied).toHaveLength(1)
    expect(evaluateOffers([weekdays], context({ at: lateFriday })).skipped[0]).toMatchObject({
      reason: 'SCHEDULE',
    })
  })

  it('окно 14:00–17:00: в 16:59 да, в 17:00 уже нет', () => {
    const quiet = offer({ schedule: { timeWindow: { from: '14:00', to: '17:00' } } })

    expect(
      evaluateOffers([quiet], context({ at: new Date('2026-09-18T09:59:00.000Z') })).applied,
    ).toHaveLength(1)
    expect(
      evaluateOffers([quiet], context({ at: new Date('2026-09-18T10:00:00.000Z') })).skipped[0],
    ).toMatchObject({ reason: 'TIME_WINDOW', message: 'Действует с 14:00 до 17:00' })
  })

  it('окно через полночь 22:00–02:00: в 01:00 да, в 03:00 нет', () => {
    const night = offer({ schedule: { timeWindow: { from: '22:00', to: '02:00' } } })

    expect(
      evaluateOffers([night], context({ at: new Date('2026-09-18T18:00:00.000Z') })).applied,
    ).toHaveLength(1)
    expect(
      evaluateOffers([night], context({ at: new Date('2026-09-18T20:00:00.000Z') })).skipped[0]
        ?.reason,
    ).toBe('TIME_WINDOW')
  })

  it('до начала — с датой по часам заведения; после конца — «закончилась»', () => {
    const future = offer({ schedule: { startsAt: '2026-09-19T00:00:00+07:00' } })
    const past = offer({ schedule: { endsAt: '2026-09-17T23:59:00+07:00' } })
    const outcome = evaluateOffers([future, past], context())

    expect(outcome.skipped).toEqual([
      expect.objectContaining({ reason: 'SCHEDULE', message: 'Акция начнётся 19.09' }),
      expect.objectContaining({ reason: 'SCHEDULE', message: 'Акция уже закончилась' }),
    ])
  })

  it('ПРИЧИНА — ПЕРВАЯ НЕПРОЙДЕННАЯ: В ВЫХОДНОЙ ГОВОРИМ ПРО ДНИ НЕДЕЛИ, А НЕ ПРО СУММУ', () => {
    const saturday = new Date('2026-09-19T09:30:00.000Z')
    const outcome = evaluateOffers(
      [offer({ schedule: { weekdays: [1, 2, 3, 4, 5] } })],
      context({ at: saturday, amount: 10_000, amountToPay: 10_000 }),
    )

    expect(outcome.skipped[0]?.reason).toBe('SCHEDULE')
  })

  it('битая таймзона заведения не роняет кассу — считаем по Бангкоку', () => {
    const quiet = offer({ schedule: { timeWindow: { from: '16:00', to: '17:00' } } })

    expect(evaluateOffers([quiet], context({ timezone: 'Nowhere/Void' })).applied).toHaveLength(1)
  })
})

describe('Кому и сколько', () => {
  it('аудитории: первый визит, туристы, резиденты', () => {
    expect(
      evaluateOffers([offer({ audience: { kind: 'NEW' } })], context()).skipped[0],
    ).toMatchObject({ reason: 'AUDIENCE', message: 'Только для первого визита' })
    expect(
      evaluateOffers([offer({ audience: { kind: 'RESIDENT' } })], context()).skipped[0]?.message,
    ).toBe('Только для резидентов')
    expect(
      evaluateOffers([offer({ audience: { kind: 'TOURIST' } })], context()).applied,
    ).toHaveLength(1)
  })

  it('СПЯЩИЕ: НЕ БЫЛ 31 ДЕНЬ — ДА, 29 ДНЕЙ — НЕТ, НИКОГДА НЕ БЫЛ — НЕ СПЯЩИЙ', () => {
    const winback = offer({ audience: { kind: 'SLEEPING', notVisitedDays: 30 } })
    const ago = (days: number): Date => new Date(AT.getTime() - days * DAY_MS)
    const guest = (lastVisitAt: Date | null): RuleContext =>
      context({ guest: { isNew: false, mode: 'RESIDENT', lastVisitAt, isControlGroup: false } })

    expect(evaluateOffers([winback], guest(ago(31))).applied).toHaveLength(1)
    expect(evaluateOffers([winback], guest(ago(29))).skipped[0]?.message).toBe(
      'Для тех, кто не был больше 30 дней',
    )
    expect(evaluateOffers([winback], guest(null)).skipped[0]?.reason).toBe('AUDIENCE')
  })

  it('ЛИМИТЫ ПРОМОКОДОВ: ГОСТЮ — ОДИН, ВСЕГО — ПЯТЬ', () => {
    expect(
      evaluateOffers([offer({ issued: { total: 3, toGuest: 1 } })], context()).skipped[0],
    ).toMatchObject({ reason: 'LIMIT_REACHED', message: 'Гость уже получал эту акцию' })
    expect(
      evaluateOffers(
        [offer({ limits: { totalQty: 5 }, issued: { total: 5, toGuest: 0 } })],
        context(),
      ).skipped[0]?.message,
    ).toBe('Акция разобрана: все промокоды выданы')
    expect(
      evaluateOffers(
        [offer({ limits: { totalQty: 5 }, issued: { total: 4, toGuest: 0 } })],
        context(),
      ).applied,
    ).toHaveLength(1)
  })

  it('КОНТРОЛЬНАЯ ГРУППА — БЕЗ АКЦИЙ, ИНАЧЕ НЕЧЕМ ДОКАЗАТЬ ЭФФЕКТ ПРОГРАММЫ', () => {
    const outcome = evaluateOffers(
      [cashback(10), offer()],
      context({
        guest: { isNew: false, mode: 'TOURIST', lastVisitAt: null, isControlGroup: true },
      }),
    )

    expect(outcome.applied).toEqual([])
    expect(outcome.skipped.map((item) => item.reason)).toEqual(['CONTROL_GROUP', 'CONTROL_GROUP'])
    expect(outcome.earnDelta).toBe(0)
  })

  it('ОШИБКА НАСТРОЙКИ ВИДНА КАССИРУ: КЭШБЭК С ПРОМОКОДОМ, ПУСТАЯ АУДИТОРИЯ, ЧУЖОЙ ТИП', () => {
    const outcome = evaluateOffers(
      [offer({ type: 'CASHBACK' }), offer({ audience: {} }), offer({ type: 'NETWORK_VOUCHER' })],
      context(),
    )

    expect(outcome.applied).toEqual([])
    expect(outcome.skipped.map((item) => item.reason)).toEqual([
      'MISCONFIGURED',
      'MISCONFIGURED',
      'MISCONFIGURED',
    ])
  })
})
