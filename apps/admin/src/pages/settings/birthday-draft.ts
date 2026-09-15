import { BIRTHDAY_POINTS_MAX, BIRTHDAY_WINDOW_MAX_DAYS } from '@positive/contracts'
import type { BirthdaySettings } from '@positive/contracts'

import { bahtToMinor } from '../../shared/format/baht-input'

/**
 * Черновик подарка ко дню рождения. docs/02, раздел 5.6.3 · docs/11, У9.
 *
 * Баллы — в батах, в сатанги переводятся здесь (железное правило 4).
 *
 * ВЫКЛЮЧЕНО — ЧИНИТЬ НЕЧЕГО, как у приглашений друзей: поля спрятаны, и проблема
 * в невидимом поле заперла бы кнопку. Выключенный подарок сохраняется всегда —
 * годное как есть, негодное значениями по умолчанию.
 */

const DEFAULT_POINTS = 10_000
const DEFAULT_WINDOW = 3

export interface BirthdayDraft {
  readonly enabled: boolean
  readonly kind: 'POINTS' | 'CERTIFICATE'
  readonly points: string
  readonly certificateId: string
  readonly daysBefore: string
  readonly daysAfter: string
}

export type BirthdayProblem = 'points' | 'certificate' | 'window'

export type BirthdayCheck =
  | { readonly ok: true; readonly settings: BirthdaySettings }
  | { readonly ok: false; readonly problem: BirthdayProblem }

export const toBirthdayDraft = (settings: BirthdaySettings): BirthdayDraft => ({
  enabled: settings.enabled,
  kind: settings.reward.kind,
  points: settings.reward.kind === 'POINTS' ? String(settings.reward.amount / 100) : '',
  certificateId: settings.reward.kind === 'CERTIFICATE' ? settings.reward.certificateId : '',
  daysBefore: String(settings.daysBefore),
  daysAfter: String(settings.daysAfter),
})

const windowDays = (value: string): number | null => {
  const trimmed = value.trim()
  const number = /^\d{1,2}$/.test(trimmed) ? Number(trimmed) : null
  return number !== null && number <= BIRTHDAY_WINDOW_MAX_DAYS ? number : null
}

export const fromBirthdayDraft = (draft: BirthdayDraft): BirthdayCheck => {
  const points = bahtToMinor(draft.points)
  const goodPoints = points !== null && points <= BIRTHDAY_POINTS_MAX ? points : null
  const before = windowDays(draft.daysBefore)
  const after = windowDays(draft.daysAfter)

  if (!draft.enabled) {
    return {
      ok: true,
      settings: {
        enabled: false,
        reward:
          draft.kind === 'CERTIFICATE' && draft.certificateId !== ''
            ? { kind: 'CERTIFICATE', certificateId: draft.certificateId }
            : { kind: 'POINTS', amount: goodPoints ?? DEFAULT_POINTS },
        daysBefore: before ?? DEFAULT_WINDOW,
        daysAfter: after ?? DEFAULT_WINDOW,
      },
    }
  }

  if (draft.kind === 'POINTS' && goodPoints === null) {
    return { ok: false, problem: 'points' }
  }

  if (draft.kind === 'CERTIFICATE' && draft.certificateId === '') {
    return { ok: false, problem: 'certificate' }
  }

  if (before === null || after === null) {
    return { ok: false, problem: 'window' }
  }

  return {
    ok: true,
    settings: {
      enabled: true,
      reward:
        draft.kind === 'CERTIFICATE'
          ? { kind: 'CERTIFICATE', certificateId: draft.certificateId }
          : { kind: 'POINTS', amount: goodPoints ?? DEFAULT_POINTS },
      daysBefore: before,
      daysAfter: after,
    },
  }
}
