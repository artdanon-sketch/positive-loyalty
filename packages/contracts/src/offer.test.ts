import { describe, expect, it } from 'vitest'

import { offerHowTo, offerTitle } from './offer.js'

/**
 * Тексты акции по языкам.
 *
 * Проверяется цепочка запасных вариантов. Ошибка здесь тихая: подарок
 * не сломается, он просто станет безымянным — а безымянный подарок кассир
 * не знает, что выдать, и гость не знает, что просить.
 */

const i18n = {
  title: { ru: 'Ролл в подарок', en: 'Free roll' },
  howTo: { ru: ['Закажите на 800 ฿', 'Покажите код'], en: ['Order 800 ฿', 'Show the code'] },
}

describe('Название акции', () => {
  it('отдаёт нужный язык', () => {
    expect(offerTitle(i18n, 'ru')).toBe('Ролл в подарок')
    expect(offerTitle(i18n, 'en')).toBe('Free roll')
  })

  it('ПАДАЕТ НА ЗАПАСНОЙ ЯЗЫК В ЗАДАННОМ ПОРЯДКЕ, А НЕ НА ПЕРВЫЙ ПОПАВШИЙСЯ', () => {
    // Гость-китаец, которому не перевели название, должен увидеть его
    // по-английски, а не по-тайски — хотя тайский в этой карте идёт первым.
    // Порядок запасных языков задан намеренно, и проверять его надо картой,
    // где первый ключ НЕ из этого порядка: иначе тест пройдёт и без него.
    const thaiFirst = { title: { th: 'ของขวัญ', en: 'Free roll', ru: 'Ролл в подарок' } }

    expect(offerTitle(thaiFirst, 'zh')).toBe('Ролл в подарок')

    const withoutRussian = { title: { th: 'ของขวัญ', en: 'Free roll' } }

    expect(offerTitle(withoutRussian, 'zh')).toBe('Free roll')
  })

  it('берёт хоть какой-то язык, если ни русского, ни английского нет', () => {
    expect(offerTitle({ title: { th: 'ของขวัญ' } }, 'ru')).toBe('ของขวัญ')
  })

  it('ПУСТАЯ СТРОКА НЕ СЧИТАЕТСЯ ПЕРЕВОДОМ', () => {
    // Иначе одно пустое поле в админке молча отключает запасные варианты.
    expect(offerTitle({ title: { ru: '   ', en: 'Free roll' } }, 'ru')).toBe('Free roll')
  })

  it('НЕТ НАЗВАНИЯ — null, А НЕ ОШИБКА', () => {
    // У всех нынешних акций i18n равен {}. Строгий разбор означал бы,
    // что промокод нельзя погасить, пока кто-то не заполнит тексты.
    expect(offerTitle({}, 'ru')).toBeNull()
    expect(offerTitle(null, 'ru')).toBeNull()
    expect(offerTitle({ title: 'строкой, а не картой' }, 'ru')).toBeNull()
  })
})

describe('Шаги «как воспользоваться»', () => {
  it('отдаёт нужный язык', () => {
    expect(offerHowTo(i18n, 'en')).toEqual(['Order 800 ฿', 'Show the code'])
  })

  it('падает на запасной язык', () => {
    expect(offerHowTo(i18n, 'th')).toEqual(['Закажите на 800 ฿', 'Покажите код'])
  })

  it('ПУСТОЙ СПИСОК НЕ СЧИТАЕТСЯ ПЕРЕВОДОМ', () => {
    expect(offerHowTo({ howTo: { ru: [], en: ['Order first'] } }, 'ru')).toEqual(['Order first'])
  })

  it('шагов нет — пустой список, а не ошибка', () => {
    expect(offerHowTo({}, 'ru')).toEqual([])
  })
})
