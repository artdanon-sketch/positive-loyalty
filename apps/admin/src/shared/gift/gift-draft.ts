import { BIRTHDAY_POINTS_MAX } from '@positive/contracts'
import type { BroadcastGift } from '@positive/contracts'

import { bahtToMinor } from '../format/baht-input'

/**
 * Черновик подарка к рассылке или автосценарию. docs/02, разделы 5.4 и 5.4.1.
 *
 * Та же форма, что у подарка ко дню рождения: баллы или сертификат из шаблона.
 * Баллы владелец вводит в батах, в сатанги они переводятся здесь — и больше
 * нигде (железное правило 4). «Без подарка» — законный выбор, а не пустое поле.
 */

export type GiftKind = 'NONE' | 'POINTS' | 'CERTIFICATE'

export interface GiftDraft {
  readonly kind: GiftKind
  readonly points: string
  readonly certificateId: string
}

export type GiftProblem = 'points' | 'certificate'

export type GiftCheck =
  | { readonly ok: true; readonly gift: BroadcastGift | null }
  | { readonly ok: false; readonly problem: GiftProblem }

export const NO_GIFT: GiftDraft = { kind: 'NONE', points: '', certificateId: '' }

export const toGiftDraft = (gift: BroadcastGift | null): GiftDraft => {
  if (gift === null) {
    return NO_GIFT
  }

  return gift.kind === 'POINTS'
    ? { kind: 'POINTS', points: String(gift.amount / 100), certificateId: '' }
    : { kind: 'CERTIFICATE', points: '', certificateId: gift.certificateId }
}

export const fromGiftDraft = (draft: GiftDraft): GiftCheck => {
  if (draft.kind === 'NONE') {
    return { ok: true, gift: null }
  }

  if (draft.kind === 'CERTIFICATE') {
    return draft.certificateId === ''
      ? { ok: false, problem: 'certificate' }
      : { ok: true, gift: { kind: 'CERTIFICATE', certificateId: draft.certificateId } }
  }

  const amount = bahtToMinor(draft.points)

  return amount === null || amount <= 0 || amount > BIRTHDAY_POINTS_MAX
    ? { ok: false, problem: 'points' }
    : { ok: true, gift: { kind: 'POINTS', amount } }
}

/** Одинаковые ли подарки — для кнопки «Сохранить», горящей только при изменении. */
export const sameGift = (left: BroadcastGift | null, right: BroadcastGift | null): boolean => {
  if (left === null || right === null) {
    return left === right
  }

  if (left.kind === 'POINTS' && right.kind === 'POINTS') {
    return left.amount === right.amount
  }

  return (
    left.kind === 'CERTIFICATE' &&
    right.kind === 'CERTIFICATE' &&
    left.certificateId === right.certificateId
  )
}
