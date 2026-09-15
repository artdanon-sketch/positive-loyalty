import { describe, expect, it } from 'vitest'

import { engineOfferTexts } from './offer-texts.js'

describe('Тексты акции из конструктора', () => {
  it('«ВЕРНЁМ 200 ฿»: ЧТО ПОКАЗАТЬ, ЧТО ДАЁТ, СКОЛЬКО ЖИВЁТ — БЕЗ ПОРОГА, ЗА КОТОРЫЙ ВЫДАН', () => {
    const texts = engineOfferTexts({
      title: 'Вернём 200 ฿',
      limits: { minCheck: 80_000 },
      reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 20_000 }, validityDays: 1 },
    })

    expect(texts.title).toEqual({ ru: 'Вернём 200 ฿', en: 'Вернём 200 ฿' })
    expect(texts.howTo?.['ru']).toEqual([
      'Покажите код на кассе',
      'Скидка 200 ฿',
      'Действует 1 день с выдачи',
    ])
    expect(texts.howTo?.['en']).toEqual([
      'Show the code at the till',
      '200 ฿ off',
      'Valid for 1 day',
    ])
  })

  it('процент с потолком и подарок вещью', () => {
    expect(
      engineOfferTexts({
        title: 'Минус 15%',
        limits: {},
        reward: {
          kind: 'GIFT_CODE',
          gift: { kind: 'PERCENT_OFF', percent: 15, maxDiscount: 30_000 },
          validityDays: 14,
        },
      }).howTo?.['ru'],
    ).toEqual([
      'Покажите код на кассе',
      'Скидка 15%, но не больше 300 ฿',
      'Действует 14 дней с выдачи',
    ])

    expect(
      engineOfferTexts({
        title: 'Десерт',
        limits: {},
        reward: {
          kind: 'GIFT_CODE',
          gift: { kind: 'FREE_ITEM', itemName: 'Чизкейк' },
          validityDays: 3,
        },
      }).howTo?.['ru']?.slice(1),
    ).toEqual(['Чизкейк в подарок', 'Действует 3 дня с выдачи'])
  })

  it('склонение срока: 21 день, 11 дней, 22 дня', () => {
    const days = (validityDays: number): string | undefined =>
      engineOfferTexts({
        title: 'Код',
        limits: {},
        reward: { kind: 'GIFT_CODE', gift: { kind: 'FIXED_OFF', amount: 10_000 }, validityDays },
      }).howTo?.['ru']?.[2]

    expect(days(21)).toBe('Действует 21 день с выдачи')
    expect(days(11)).toBe('Действует 11 дней с выдачи')
    expect(days(22)).toBe('Действует 22 дня с выдачи')
  })

  it('кэшбэк: как начисляется и с какого чека; разряды — неразрывным пробелом', () => {
    const texts = engineOfferTexts({
      title: 'Кэшбэк 5%',
      limits: { minCheck: 150_000 },
      reward: { kind: 'EARN_PERCENT', percent: 5 },
    })

    expect(texts.howTo?.['ru']?.[0]).toBe('Кэшбэк 5% баллами — начисляется к чеку сам')
    expect(texts.howTo?.['ru']?.[1]).toMatch(/^При чеке от 1\s500 ฿$/)
    expect(
      engineOfferTexts({
        title: 'Кэшбэк',
        limits: {},
        reward: { kind: 'EARN_PERCENT', percent: 5 },
      }).howTo?.['ru'],
    ).toHaveLength(1)
  })
})
