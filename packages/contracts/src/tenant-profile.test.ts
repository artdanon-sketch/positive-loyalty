import { describe, expect, it } from 'vitest'

import { TenantProfile, TenantProfileExtra } from './tenant-profile'

/**
 * Профиль — единственное место, где владелец может сдвинуть себе сутки.
 * Поэтому пояс проверяется не списком, а тем же механизмом, который его применит.
 */

const profile = (extra: Record<string, unknown> = {}) => ({
  brandName: 'Kata Beach Kitchen',
  vertical: 'RESTAURANT',
  timezone: 'Asia/Bangkok',
  locale: 'th',
  ...extra,
})

describe('Профиль заведения', () => {
  it('МИНИМУМ — ИМЯ, ВИД, ПОЯС И ЯЗЫК; ОСТАЛЬНОЕ ЗАПОЛНЯЕТСЯ ПОТОМ', () => {
    expect(TenantProfile.parse(profile())).toMatchObject({
      legalName: null,
      about: '',
      phone: null,
      website: null,
      address: '',
      hours: '',
    })
  })

  it('НЕИЗВЕСТНЫЙ ЧАСОВОЙ ПОЯС НЕ СОХРАНЯЕТСЯ: ОТ НЕГО ЗАВИСИТ ВЫРУЧКА ЗА ДЕНЬ', () => {
    expect(TenantProfile.safeParse(profile({ timezone: 'Asia/Phuket' })).success).toBe(false)
    expect(TenantProfile.safeParse(profile({ timezone: 'Europe/Moscow' })).success).toBe(true)
  })

  it('САЙТ — ССЫЛКА, А НЕ ПРОСТО СЛОВА', () => {
    expect(TenantProfile.safeParse(profile({ website: 'katabeach' })).success).toBe(false)
    expect(TenantProfile.safeParse(profile({ website: 'https://kata.example' })).success).toBe(true)
  })

  it('ПУСТОЕ ИМЯ И ЛИШНЕЕ ПОЛЕ — ОТКАЗ', () => {
    expect(TenantProfile.safeParse(profile({ brandName: ' ' })).success).toBe(false)
    expect(TenantProfile.safeParse(profile({ plan: 'PRO' })).success).toBe(false)
  })

  it('НЕЗАПОЛНЕННЫЙ ПРОФИЛЬ ЧИТАЕТСЯ, А НЕ ПАДАЕТ', () => {
    expect(TenantProfileExtra.parse({})).toEqual({
      about: '',
      phone: null,
      website: null,
      address: '',
      hours: '',
    })
  })
})
