import { describe, expect, it } from 'vitest'

import {
  AdminGuestCardQuery,
  AdminGuestsQuery,
  AdminTimelineGift,
  AdminTimelineItem,
} from './admin.js'

const GIFT = {
  kind: 'GIFT',
  grantId: '14141414-1414-4141-8141-141414141414',
  at: '2026-09-05T13:12:00.000Z',
  title: 'Десерт в подарок',
  codeTail: 'K7QX',
  state: 'REDEEMED',
  expiresAt: '2026-10-05T13:12:00.000Z',
  redeemedAt: '2026-09-06T11:00:00.000Z',
  redeemedReceiptId: '1042',
}

describe('Поиск гостей: запрос', () => {
  it('поиск обрезается по краям, постраничность по умолчанию на месте', () => {
    expect(AdminGuestsQuery.parse({ q: '  4821 ' })).toEqual({ q: '4821', limit: 20, offset: 0 })
  })

  it('без поиска — обычный список', () => {
    expect(AdminGuestsQuery.parse({})).toEqual({ limit: 20, offset: 0 })
  })

  it('строка длиннее 64 знаков — не поиск', () => {
    expect(AdminGuestsQuery.safeParse({ q: 'а'.repeat(65) }).success).toBe(false)
  })

  it('лишний параметр отвергается: заведение не выбирают в запросе', () => {
    expect(AdminGuestsQuery.safeParse({ tenantId: 'x' }).success).toBe(false)
  })

  it('ПОКУПКИ, БАЛЛЫ, ДЕНЬ РОЖДЕНИЯ И ПОРЯДОК ПРИХОДЯТ СТРОКАМИ ИЗ АДРЕСА', () => {
    expect(
      AdminGuestsQuery.parse({
        visitsFrom: '5',
        pointsTo: '0',
        birthday: 'week',
        sort: 'spent',
      }),
    ).toEqual({
      limit: 20,
      offset: 0,
      visitsFrom: 5,
      pointsTo: 0,
      birthday: 'week',
      sort: 'spent',
    })
  })

  it('НОЛЬ ПОКУПОК — НЕ ДИАПАЗОН, А ФИЛЬТР «НЕ ПОКУПАЛИ»; НЕИЗВЕСТНОЕ — ОТКАЗ', () => {
    expect(AdminGuestsQuery.safeParse({ visitsFrom: '0' }).success).toBe(false)
    expect(AdminGuestsQuery.safeParse({ pointsFrom: '-1' }).success).toBe(false)
    expect(AdminGuestsQuery.safeParse({ birthday: 'year' }).success).toBe(false)
    expect(AdminGuestsQuery.safeParse({ sort: 'random' }).success).toBe(false)
  })
})

describe('Карточка гостя: схема', () => {
  it('язык по умолчанию русский, неизвестный отвергается', () => {
    expect(AdminGuestCardQuery.parse({})).toEqual({ locale: 'ru' })
    expect(AdminGuestCardQuery.safeParse({ locale: 'de' }).success).toBe(false)
  })

  it('ПОЛНЫЙ КОД ПОДАРКА СХЕМУ НЕ ПРОХОДИТ — только хвост из четырёх знаков', () => {
    expect(AdminTimelineGift.safeParse(GIFT).success).toBe(true)
    expect(AdminTimelineGift.safeParse({ ...GIFT, codeTail: 'GK7QX2M9P' }).success).toBe(false)
  })

  it('в ленте только операции и подарки', () => {
    expect(AdminTimelineItem.safeParse(GIFT).success).toBe(true)
    expect(AdminTimelineItem.safeParse({ ...GIFT, kind: 'NOTE' }).success).toBe(false)
  })
})
