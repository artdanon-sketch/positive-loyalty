import { describe, expect, it } from 'vitest'

import { BLANK_ITEM, fromItemDraft } from './item-draft'

/**
 * Перевод батов в сатанги живёт в одном месте, и проверяется он здесь: если он
 * размажется по экрану, однажды позиция за 320 ฿ станет позицией за 3,20 ฿.
 */

const draft = (extra: Partial<typeof BLANK_ITEM> = {}) => ({
  ...BLANK_ITEM,
  name: 'Кофе в подарок',
  ...extra,
})

describe('Черновик позиции каталога', () => {
  it('ЦЕНА В БАТАХ УХОДИТ В САТАНГАХ', () => {
    const result = fromItemDraft(draft({ priceBaht: '320' }), 0)

    expect(result).toMatchObject({ ok: true, input: { priceMinor: 32_000 } })
  })

  it('ДРОБНАЯ ЦЕНА ЧЕРЕЗ ЗАПЯТУЮ ТОЖЕ СЧИТАЕТСЯ: ТАК ПИШУТ ЛЮДИ', () => {
    expect(fromItemDraft(draft({ priceBaht: '99,50' }), 0)).toMatchObject({
      ok: true,
      input: { priceMinor: 9_950 },
    })
  })

  it('ПОЗИЦИЯ ТОЛЬКО ЗА БАЛЛЫ — ЭТО НОРМА; ЦЕНА В БАЛЛАХ — В БАТАХ, КАК БАЛАНС ГОСТЯ', () => {
    // «60» — это 60,00 ฿ баллами: журнал списывает в тех же сотых долях, в каких
    // гость видит свой баланс.
    expect(fromItemDraft(draft({ points: '60' }), 0)).toMatchObject({
      ok: true,
      input: { priceMinor: null, pointsPrice: 6_000 },
    })
    expect(fromItemDraft(draft({ points: '12,5' }), 0)).toMatchObject({
      input: { pointsPrice: 1_250 },
    })
  })

  it('БЕЗ ЕДИНОЙ ЦЕНЫ ПОЗИЦИЯ БЕССМЫСЛЕННА', () => {
    expect(fromItemDraft(draft(), 0)).toEqual({ ok: false, problem: 'price' })
  })

  it('БЕЗ ИМЕНИ НЕ СОХРАНЯЕМ', () => {
    expect(fromItemDraft(draft({ name: ' ', priceBaht: '100' }), 0)).toEqual({
      ok: false,
      problem: 'name',
    })
  })

  it('НОЛЬ БАЛЛОВ — ЭТО «НЕ ЗА БАЛЛЫ», А НЕ «БЕСПЛАТНО»', () => {
    expect(fromItemDraft(draft({ priceBaht: '100', points: '0' }), 0)).toMatchObject({
      ok: true,
      input: { pointsPrice: null },
    })
  })

  it('КАРТИНКА ТОЛЬКО ПО HTTPS', () => {
    expect(
      fromItemDraft(draft({ priceBaht: '100', imageUrl: 'http://a.example/x.jpg' }), 0),
    ).toEqual({ ok: false, problem: 'image' })
  })

  it('ПОРЯДОК ВИТРИНЫ ПРИХОДИТ СНАРУЖИ: НОВАЯ ПОЗИЦИЯ ВСТАЁТ В КОНЕЦ', () => {
    expect(fromItemDraft(draft({ priceBaht: '100' }), 7)).toMatchObject({
      ok: true,
      input: { sortOrder: 7 },
    })
  })
})
