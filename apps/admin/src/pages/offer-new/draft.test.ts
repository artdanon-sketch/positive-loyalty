import { describe, expect, it } from 'vitest'

import { bahtToMinor } from '../../shared/format/baht-input'
import { draftOffer, draftRules, templateDraft } from './draft'
import type { OfferDraft } from './draft'

const WORDS = { title: 'Вернём 200 ฿', item: 'Десерт' }

const custom = (patch: Partial<OfferDraft>): OfferDraft => ({
  ...templateDraft('CUSTOM', WORDS),
  title: 'Своя акция',
  giftAmount: '100',
  ...patch,
})

const problemOf = (draft: OfferDraft): string | null => {
  const checked = draftOffer(draft, 'NOW')
  return checked.ok ? null : checked.problem
}

describe('Конструктор: шаблоны', () => {
  it('«ВЕРНУТЬ ГОСТЯ ЗАВТРА» — ПРОМОКОД 200 ฿ ЗА ЧЕК ОТ 800 ฿, ОДИН НА ГОСТЯ, НА СУТКИ', () => {
    expect(draftOffer(templateDraft('RETURN_TOMORROW', WORDS), 'NOW')).toEqual({
      ok: true,
      offer: {
        type: 'PROMO_ON_CHECK',
        title: 'Вернём 200 ฿',
        audience: { kind: 'ALL' },
        schedule: {},
        limits: { minCheck: 80_000, perGuestQty: 1 },
        reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 20_000 }, validityDays: 1 },
        stackable: true,
        priority: 100,
        launch: 'NOW',
      },
    })
  })

  it('«тихие часы» — кэшбэк по будням в окне; лимитов выдач у кэшбэка нет', () => {
    const rules = draftRules(templateDraft('QUIET_HOURS', WORDS))

    expect(rules).toEqual({
      ok: true,
      rules: {
        type: 'CASHBACK',
        audience: { kind: 'ALL' },
        schedule: { weekdays: [1, 2, 3, 4], timeWindow: { from: '14:00', to: '17:00' } },
        limits: {},
        reward: { kind: 'EARN_PERCENT', percent: 10 },
      },
    })
  })

  it('«спящие» и «новичок» — аудитория доезжает до правил', () => {
    const sleeping = draftRules(templateDraft('WAKE_SLEEPING', WORDS))
    const welcome = draftOffer(templateDraft('WELCOME', WORDS), 'DRAFT')

    expect(sleeping.ok && sleeping.rules.audience).toEqual({ kind: 'SLEEPING', notVisitedDays: 30 })
    expect(welcome.ok && welcome.offer).toMatchObject({
      audience: { kind: 'NEW' },
      reward: { kind: 'GIFT_CODE', gift: { kind: 'FREE_ITEM', itemName: 'Десерт' } },
      launch: 'DRAFT',
    })
  })
})

describe('Конструктор: что поправить', () => {
  it('«СВОЯ АКЦИЯ» С ЧИСТОГО ЛИСТА: СНАЧАЛА НАЗВАНИЕ, ПОТОМ СУММА СКИДКИ', () => {
    const blank = templateDraft('CUSTOM', WORDS)

    expect(problemOf(blank)).toBe('title')
    expect(problemOf({ ...blank, title: 'Минус 100 ฿' })).toBe('giftAmount')
    expect(problemOf({ ...blank, title: 'Минус 100 ฿', giftAmount: '100' })).toBeNull()
  })

  it('ПУСТОЕ ПОЛЕ — «БЕЗ ОГРАНИЧЕНИЯ», А НЕ НОЛЬ; НОЛЬ И МУСОР — ОШИБКА', () => {
    const rules = draftRules(custom({ minCheck: '', perGuestQty: '', totalQty: '' }))

    expect(rules.ok && rules.rules.limits).toEqual({})
    expect(problemOf(custom({ minCheck: '0' }))).toBe('minCheck')
    expect(problemOf(custom({ totalQty: 'много' }))).toBe('totalQty')
  })

  it('суммы — в сатанги одним местом: запятая, копейки, мусор', () => {
    expect(bahtToMinor('800')).toBe(80_000)
    expect(bahtToMinor('799,5')).toBe(79_950)
    expect(bahtToMinor(' 799.99 ')).toBe(79_999)
    expect(bahtToMinor('0')).toBeNull()
    expect(bahtToMinor('1.234')).toBeNull()
    expect(bahtToMinor('-5')).toBeNull()
  })

  it('кэшбэк не берёт лимиты промокода, даже если они заполнены', () => {
    const rules = draftRules(custom({ type: 'CASHBACK', perGuestQty: '3', totalQty: '100' }))

    expect(rules.ok && rules.rules.limits).toEqual({})
  })

  it('процент с потолком и без; подарок вещью без названия не проходит', () => {
    const capped = draftRules(
      custom({ giftKind: 'PERCENT_OFF', giftPercent: '15', giftMaxDiscount: '300' }),
    )

    expect(capped.ok && capped.rules.reward).toEqual({
      kind: 'GIFT_CODE',
      gift: { kind: 'PERCENT_OFF', percent: 15, maxDiscount: 30_000 },
      validityDays: 14,
    })
    expect(problemOf(custom({ giftKind: 'PERCENT_OFF', giftPercent: '101' }))).toBe('giftPercent')
    expect(problemOf(custom({ giftKind: 'FREE_ITEM', giftItem: '  ' }))).toBe('giftItem')
  })
})

describe('Конструктор: когда', () => {
  it('ВСЕ СЕМЬ ДНЕЙ — ТО ЖЕ, ЧТО БЕЗ ОГРАНИЧЕНИЯ; ДНИ ИДУТ ПО ПОРЯДКУ', () => {
    const everyDay = draftRules(custom({ weekdays: [7, 6, 5, 4, 3, 2, 1] }))
    const weekend = draftRules(custom({ weekdays: [7, 6, 6] }))

    expect(everyDay.ok && everyDay.rules.schedule).toEqual({})
    expect(weekend.ok && weekend.rules.schedule).toEqual({ weekdays: [6, 7] })
  })

  it('ДАТЫ — ПО ЧАСАМ ПХУКЕТА: С НАЧАЛА ПЕРВОГО ДНЯ ДО КОНЦА ПОСЛЕДНЕГО; ОДИН ДЕНЬ — МОЖНО', () => {
    const oneDay = draftRules(custom({ startsOn: '2026-09-20', endsOn: '2026-09-20' }))

    expect(oneDay.ok && oneDay.rules.schedule).toEqual({
      startsAt: '2026-09-20T00:00:00+07:00',
      endsAt: '2026-09-20T23:59:59+07:00',
    })
    expect(problemOf(custom({ startsOn: '2026-09-21', endsOn: '2026-09-20' }))).toBe('period')
  })

  it('окно времени — оба конца и разные', () => {
    expect(problemOf(custom({ timeFrom: '14:00' }))).toBe('timeWindow')
    expect(problemOf(custom({ timeFrom: '14:00', timeTo: '14:00' }))).toBe('timeWindow')
    expect(problemOf(custom({ timeFrom: '22:00', timeTo: '02:00' }))).toBeNull()
  })
})
