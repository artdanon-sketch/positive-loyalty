import type { TenantProfile } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n'

/**
 * Черновик профиля заведения. docs/03, раздел 9.
 *
 * ПОЯСА — СПИСКОМ, А НЕ СВОБОДНЫМ ПОЛЕМ. «Asia/Phuket» выглядит правильнее
 * «Asia/Bangkok» для человека на Пхукете, но такого пояса не существует, и
 * ошибка нашлась бы только в отчёте за день. Список короткий: те места,
 * откуда к нам приходят.
 */

export const TIMEZONES = [
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Jakarta',
  'Asia/Ho_Chi_Minh',
  'Asia/Dubai',
  'Europe/Moscow',
  'Europe/London',
  'UTC',
] as const

export const VERTICALS = ['RESTAURANT', 'SPA', 'RENTAL', 'RETAIL', 'OTHER'] as const

export const VERTICAL_LABEL: Readonly<Record<(typeof VERTICALS)[number], TranslationKey>> = {
  RESTAURANT: 'profile.vertical.restaurant',
  SPA: 'profile.vertical.spa',
  RENTAL: 'profile.vertical.rental',
  RETAIL: 'profile.vertical.retail',
  OTHER: 'profile.vertical.other',
}

export const LOCALES = ['th', 'en', 'ru'] as const

/** Что мешает сохранить. Пустой список — можно. */
export const profileIssues = (draft: TenantProfile): readonly TranslationKey[] => {
  const issues: TranslationKey[] = []

  if (draft.brandName.trim().length < 2) {
    issues.push('profile.issue.brandName')
  }

  // Ссылку проверяем здесь же, а не только на сервере: «katabeach.com» без
  // протокола — самая частая опечатка, и отказ после сохранения сбивает с толку.
  if (draft.website !== null && draft.website.trim().length > 0 && !isUrl(draft.website)) {
    issues.push('profile.issue.website')
  }

  return issues
}

const isUrl = (value: string): boolean => {
  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Пустое поле ссылки и телефона — это «не указано», а не пустая строка. */
export const emptyToNull = (value: string): string | null =>
  value.trim().length === 0 ? null : value.trim()
