import { describe, expect, it } from 'vitest'

import { UpdateGuestProfileInput } from './guest-profile'

/**
 * Профиль гостя — короткая анкета, и короткой она должна остаться: каждое
 * лишнее поле здесь это ещё один способ подделать себе условия.
 */

describe('Профиль гостя: что можно изменить', () => {
  it('ИМЯ И ЯЗЫК — И БОЛЬШЕ НИЧЕГО', () => {
    expect(UpdateGuestProfileInput.parse({ displayName: 'Анна', locale: 'ru' })).toEqual({
      displayName: 'Анна',
      locale: 'ru',
    })
  })

  it('«ТУРИСТ ИЛИ РЕЗИДЕНТ» НЕ АНКЕТА: ЭТО НАБЛЮДЕНИЕ СИСТЕМЫ', () => {
    const result = UpdateGuestProfileInput.safeParse({
      displayName: 'Анна',
      locale: 'ru',
      mode: 'RESIDENT',
    })

    expect(result.success).toBe(false)
  })

  it('ПУСТОЕ ИМЯ ПЕРЕДАЁТСЯ КАК null — «НЕ ПРЕДСТАВИЛСЯ», А НЕ ПУСТАЯ СТРОКА', () => {
    expect(
      UpdateGuestProfileInput.parse({ displayName: null, locale: 'th' }).displayName,
    ).toBeNull()
    expect(UpdateGuestProfileInput.safeParse({ displayName: '', locale: 'th' }).success).toBe(false)
  })

  it('ПРОБЕЛЫ ПО КРАЯМ СРЕЗАЮТСЯ: «АННА » И «АННА» — ОДИН ЧЕЛОВЕК', () => {
    expect(UpdateGuestProfileInput.parse({ displayName: '  Анна  ', locale: 'en' })).toMatchObject({
      displayName: 'Анна',
    })
  })

  it('НЕИЗВЕСТНЫЙ ЯЗЫК НЕ ПРОХОДИТ: НА НЁМ НЕКОМУ ПИСАТЬ', () => {
    expect(UpdateGuestProfileInput.safeParse({ displayName: null, locale: 'de' }).success).toBe(
      false,
    )
  })
})
