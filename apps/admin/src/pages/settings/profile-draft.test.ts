import { describe, expect, it } from 'vitest'
import type { TenantProfile } from '@positive/contracts'

import { emptyToNull, profileIssues, TIMEZONES } from './profile-draft'

/**
 * Профиль — место, где одна опечатка в поясе сдвигает выручку за день.
 * Поэтому пояс выбирается из списка, а не пишется руками.
 */

const draft = (extra: Partial<TenantProfile> = {}): TenantProfile => ({
  brandName: 'Kata Beach Kitchen',
  legalName: null,
  vertical: 'RESTAURANT',
  timezone: 'Asia/Bangkok',
  locale: 'th',
  about: '',
  phone: null,
  website: null,
  address: '',
  hours: '',
  ...extra,
})

describe('Черновик профиля заведения', () => {
  it('ЗАПОЛНЕННЫЙ ПРОФИЛЬ НЕ ВЫЗЫВАЕТ ВОЗРАЖЕНИЙ', () => {
    expect(profileIssues(draft())).toEqual([])
  })

  it('БЕЗ ИМЕНИ НЕ СОХРАНЯЕМ: ЭТО ИМЯ СТОИТ В КАЖДОМ СООБЩЕНИИ ГОСТЮ', () => {
    expect(profileIssues(draft({ brandName: ' ' }))).toEqual(['profile.issue.brandName'])
  })

  it('САЙТ БЕЗ ПРОТОКОЛА — САМАЯ ЧАСТАЯ ОПЕЧАТКА, ЛОВИМ ЕЁ ДО СЕРВЕРА', () => {
    expect(profileIssues(draft({ website: 'katabeach.com' }))).toEqual(['profile.issue.website'])
    expect(profileIssues(draft({ website: 'https://katabeach.com' }))).toEqual([])
  })

  it('ПУСТОЕ ПОЛЕ — ЭТО «НЕ УКАЗАНО», А НЕ ПУСТАЯ СТРОКА', () => {
    expect(emptyToNull('   ')).toBeNull()
    expect(emptyToNull(' +66 76 123 456 ')).toBe('+66 76 123 456')
  })

  it('В СПИСКЕ ПОЯСОВ НЕТ НЕСУЩЕСТВУЮЩЕГО «ASIA/PHUKET»', () => {
    expect(TIMEZONES).toContain('Asia/Bangkok')
    expect(TIMEZONES as readonly string[]).not.toContain('Asia/Phuket')
  })
})
