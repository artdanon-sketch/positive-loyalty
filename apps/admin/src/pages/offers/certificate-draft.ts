import { CERTIFICATE_VALIDITY_MAX_DAYS } from '@positive/contracts'
import type { CreateCertificateInput, GiftValue } from '@positive/contracts'

import { bahtToMinor } from '../../shared/format/baht-input'

/**
 * Черновик нового сертификата. docs/02, раздел 5.11 · docs/11, У9.
 *
 * ПОЛЯ — СТРОКИ, ШАБЛОН — ЧИСЛА. Скидку владелец набирает в батах, в сатанги она
 * переводится здесь (железное правило 4). Под формой одна строка «что поправить» —
 * первая по порядку полей.
 */

export type CertificateKind = GiftValue['kind']

export const CERTIFICATE_KINDS: readonly CertificateKind[] = [
  'FIXED_OFF',
  'PERCENT_OFF',
  'FREE_ITEM',
]

export interface CertificateDraft {
  readonly title: string
  readonly kind: CertificateKind
  readonly amount: string
  readonly percent: string
  readonly maxDiscount: string
  readonly itemName: string
  readonly validityDays: string
  /** Промо-сертификат: гость забирает сам из приложения. */
  readonly selfClaim: boolean
}

export type CertificateProblem =
  'title' | 'amount' | 'percent' | 'maxDiscount' | 'itemName' | 'validityDays'

export type CertificateCheck =
  | { readonly ok: true; readonly input: CreateCertificateInput }
  | { readonly ok: false; readonly problem: CertificateProblem }

export const BLANK_CERTIFICATE: CertificateDraft = {
  title: '',
  kind: 'FIXED_OFF',
  amount: '',
  percent: '',
  maxDiscount: '',
  itemName: '',
  validityDays: '30',
  selfClaim: false,
}

const wholeIn = (value: string, min: number, max: number): number | null => {
  const trimmed = value.trim()

  if (!/^\d{1,4}$/.test(trimmed)) {
    return null
  }

  const number = Number(trimmed)

  return number >= min && number <= max ? number : null
}

const valueOf = (draft: CertificateDraft): GiftValue | CertificateProblem => {
  switch (draft.kind) {
    case 'FIXED_OFF': {
      const amount = bahtToMinor(draft.amount)
      return amount === null ? 'amount' : { kind: 'FIXED_OFF', amount }
    }
    case 'PERCENT_OFF': {
      const percent = wholeIn(draft.percent, 1, 100)

      if (percent === null) {
        return 'percent'
      }

      if (draft.maxDiscount.trim() === '') {
        return { kind: 'PERCENT_OFF', percent, maxDiscount: null }
      }

      const maxDiscount = bahtToMinor(draft.maxDiscount)
      return maxDiscount === null ? 'maxDiscount' : { kind: 'PERCENT_OFF', percent, maxDiscount }
    }
    case 'FREE_ITEM': {
      const itemName = draft.itemName.trim()
      return itemName === '' || itemName.length > 200 ? 'itemName' : { kind: 'FREE_ITEM', itemName }
    }
  }
}

export const fromCertificateDraft = (draft: CertificateDraft): CertificateCheck => {
  const title = draft.title.trim()

  if (title.length < 2 || title.length > 80) {
    return { ok: false, problem: 'title' }
  }

  const value = valueOf(draft)

  if (typeof value === 'string') {
    return { ok: false, problem: value }
  }

  const validityDays = wholeIn(draft.validityDays, 1, CERTIFICATE_VALIDITY_MAX_DAYS)

  if (validityDays === null) {
    return { ok: false, problem: 'validityDays' }
  }

  return { ok: true, input: { title, value, validityDays, selfClaim: draft.selfClaim } }
}
