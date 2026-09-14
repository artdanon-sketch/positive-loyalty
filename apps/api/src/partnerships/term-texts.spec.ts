import { describe, expect, it } from 'vitest'

import { partnerOfferTexts } from './term-texts'

describe('Тексты партнёрского подарка', () => {
  it('ГОЛОВНОЙ ПРИМЕР ТЗ: ролл в подарок к заказу от 800 ฿, от студии', () => {
    const texts = partnerOfferTexts(
      { kind: 'FREE_ITEM', itemName: 'Ролл Филадельфия', minCheck: 80_000 },
      'Dance Studio Kata',
    )

    expect(texts.title?.['ru']).toBe('Ролл Филадельфия в подарок')
    expect(texts.howTo?.['ru']).toEqual([
      'Покажите код на кассе',
      'К заказу от 800 ฿',
      'Подарок от партнёра — Dance Studio Kata',
    ])
  })

  it('условие подарка — отдельным шагом: кассиру оно важнее названия', () => {
    const texts = partnerOfferTexts({ kind: 'FIXED_OFF', amount: 150_000, minCheck: 500_000 }, null)

    // Разряды разделены неразрывным пробелом.
    expect(texts.title?.['ru']).toMatch(/^Скидка 1\s500 ฿$/)
    expect(texts.howTo?.['ru']?.[1]).toMatch(/^К заказу от 5\s000 ฿$/)
  })

  it('без минимального чека условия нет, без имени партнёра — строки «от партнёра» тоже', () => {
    const texts = partnerOfferTexts({ kind: 'FREE_ITEM', itemName: 'Кофе', minCheck: 0 }, null)

    expect(texts.howTo?.['ru']).toEqual(['Покажите код на кассе'])
  })

  it('скидка в процентах с потолком', () => {
    const texts = partnerOfferTexts({ kind: 'PERCENT_OFF', percent: 15, maxDiscount: 30_000 }, null)

    expect(texts.title?.['ru']).toBe('Скидка 15%')
    expect(texts.title?.['en']).toBe('15% off')
    expect(texts.howTo?.['ru']).toContain('Скидка не больше 300 ฿')
  })

  it('английский гость получает английские шаги, а не пустоту', () => {
    const texts = partnerOfferTexts(
      { kind: 'FREE_ITEM', itemName: 'Philadelphia roll', minCheck: 80_000 },
      'Dance Studio Kata',
    )

    expect(texts.howTo?.['en']).toEqual([
      'Show the code at the till',
      'With an order of 800 ฿ or more',
      'A gift from our partner Dance Studio Kata',
    ])
  })
})
