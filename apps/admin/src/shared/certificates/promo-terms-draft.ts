import { PROMO_LIMIT_MAX } from '@positive/contracts'
import type { PromoTerms } from '@positive/contracts'

import { fill } from '../format/fill'
import { formatDate } from '../format/format'
import type { TranslationKey } from '../i18n'

/**
 * Черновик условий промо: «забрать можно с… по…» и «всего штук». docs/02, раздел 5.11.
 *
 * ДАТЫ — ДНИ, А НЕ МГНОВЕНИЯ. Владелец думает «до 31 октября», а не «до 23:59:59».
 * Начало — полночь выбранного дня, конец — последний миг дня, оба по часам
 * устройства владельца. Пустое поле — без границы.
 *
 * ПОЛЯ — СТРОКИ ПОКА ИХ ПЕЧАТАЮТ, как везде в формах бэк-офиса: «1» по пути
 * к «100» не должно стирать набранное.
 */

export interface PromoTermsDraft {
  readonly startsOn: string
  readonly endsOn: string
  readonly limit: string
}

export type PromoTermsProblem = 'promoDates' | 'promoLimit'

export type PromoTermsCheck =
  | { readonly ok: true; readonly terms: PromoTerms }
  | { readonly ok: false; readonly problem: PromoTermsProblem }

export const BLANK_PROMO_TERMS: PromoTermsDraft = { startsOn: '', endsOn: '', limit: '' }

const pad = (value: number): string => String(value).padStart(2, '0')

/** Мгновение → день по часам устройства, ГГГГ-ММ-ДД, как отдаёт поле календаря. */
const dayOf = (iso: string | null): string => {
  if (iso === null) {
    return ''
  }

  const date = new Date(iso)

  return Number.isNaN(date.getTime())
    ? ''
    : `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const isDay = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())

export const toPromoTermsDraft = (terms: PromoTerms): PromoTermsDraft => ({
  startsOn: dayOf(terms.startsAt),
  endsOn: dayOf(terms.endsAt),
  limit: terms.limit === null ? '' : String(terms.limit),
})

export const fromPromoTermsDraft = (draft: PromoTermsDraft): PromoTermsCheck => {
  const startsOn = draft.startsOn.trim()
  const endsOn = draft.endsOn.trim()
  const limitText = draft.limit.trim()

  if ((startsOn !== '' && !isDay(startsOn)) || (endsOn !== '' && !isDay(endsOn))) {
    return { ok: false, problem: 'promoDates' }
  }

  const startsAt = startsOn === '' ? null : new Date(`${startsOn}T00:00:00`).toISOString()
  const endsAt = endsOn === '' ? null : new Date(`${endsOn}T23:59:59.999`).toISOString()

  if (startsAt !== null && endsAt !== null && Date.parse(startsAt) >= Date.parse(endsAt)) {
    return { ok: false, problem: 'promoDates' }
  }

  if (limitText === '') {
    return { ok: true, terms: { startsAt, endsAt, limit: null } }
  }

  const limit = /^\d{1,7}$/.test(limitText) ? Number(limitText) : null

  return limit === null || limit < 1 || limit > PROMO_LIMIT_MAX
    ? { ok: false, problem: 'promoLimit' }
    : { ok: true, terms: { startsAt, endsAt, limit } }
}

/** Условия одной строкой для списка: «до 31.10.2026 · осталось 88 из 100». */
export const describePromoTerms = (
  terms: PromoTerms,
  issued: number,
  t: (key: TranslationKey) => string,
): string => {
  const parts: string[] = []

  if (terms.startsAt !== null) {
    parts.push(fill(t('certificates.promoTerms.from'), { date: formatDate(terms.startsAt) }))
  }

  if (terms.endsAt !== null) {
    parts.push(fill(t('certificates.promoTerms.until'), { date: formatDate(terms.endsAt) }))
  }

  if (terms.limit !== null) {
    parts.push(
      fill(t('certificates.promoTerms.left'), {
        left: String(Math.max(0, terms.limit - issued)),
        limit: String(terms.limit),
      }),
    )
  }

  return parts.length === 0 ? t('certificates.promoTerms.none') : parts.join(' · ')
}
