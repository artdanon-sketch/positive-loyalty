import {
  NO_REFERRAL_LEVELS,
  REFERRAL_LEVEL_PCT_MAX,
  REFERRAL_LIMIT_MAX,
  REFERRAL_REWARD_MAX,
} from '@positive/contracts'
import type { ReferralLevels, ReferralSettings } from '@positive/contracts'

import { bahtToMinor } from '../../shared/format/baht-input'

/**
 * Черновик приглашений друзей на экране настроек. docs/02, раздел 5.6.2.
 *
 * ПОЛЯ — СТРОКИ, НАСТРОЙКИ — ЧИСЛА. Баллы за друга владелец набирает в батах,
 * в сатанги они переводятся здесь (железное правило 4). Проценты по кругам —
 * числа с запятой или точкой, пусто — ноль.
 *
 * ВКЛЮЧЁННЫЕ ПРИГЛАШЕНИЯ ДОЛЖНЫ ЧТО-ТО ДАВАТЬ: разовые баллы за друга, процент
 * с его покупок или то и другое. Ни того, ни другого — ссылка, которая ничего
 * не приносит, и гость, обманутый собственным заведением.
 *
 * ВЫКЛЮЧЕНО — ЧИНИТЬ НЕЧЕГО. Поля при выключенных приглашениях спрятаны, и
 * проблема в невидимом поле заперла бы кнопку навсегда. Поэтому выключенные
 * сохраняются всегда: годное значение — как есть, негодное — значением по умолчанию.
 */

export const REFERRAL_LIMIT_DEFAULT = 10

export type LevelsDraft = readonly [string, string, string]

export interface ReferralDraft {
  readonly enabled: boolean
  readonly reward: string
  readonly limit: string
  readonly levels: LevelsDraft
}

export type ReferralProblem = 'reward' | 'limit' | 'levels' | 'nothing'

export type ReferralCheck =
  | { readonly ok: true; readonly settings: ReferralSettings }
  | { readonly ok: false; readonly problem: ReferralProblem }

const pctText = (value: number): string => (value === 0 ? '' : String(value).replace('.', ','))

export const toReferralDraft = (settings: ReferralSettings): ReferralDraft => {
  const levels = settings.levels ?? NO_REFERRAL_LEVELS

  return {
    enabled: settings.enabled,
    reward: settings.reward === 0 ? '' : String(settings.reward / 100),
    limit: String(settings.limit),
    levels: [pctText(levels[0] ?? 0), pctText(levels[1] ?? 0), pctText(levels[2] ?? 0)],
  }
}

/** «0» и пусто — ноль; иначе баты в сатанги. Негодное — null. */
const rewardOf = (text: string): number | null => {
  const trimmed = text.trim()

  if (trimmed === '' || /^0+([.,]0{1,2})?$/.test(trimmed)) {
    return 0
  }

  const minor = bahtToMinor(trimmed)

  return minor !== null && minor <= REFERRAL_REWARD_MAX ? minor : null
}

/** Процент на круге: от 0 до 20, до десятых. Пусто — ноль. Негодное — null. */
const pctOf = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.')

  if (trimmed === '') {
    return 0
  }

  if (!/^\d{1,2}(\.\d)?$/.test(trimmed)) {
    return null
  }

  const value = Number(trimmed)

  return value <= REFERRAL_LEVEL_PCT_MAX ? value : null
}

const levelsOf = (draft: LevelsDraft): ReferralLevels | null => {
  const values = draft.map(pctOf)

  return values.every((value): value is number => value !== null) ? values : null
}

export const fromReferralDraft = (draft: ReferralDraft): ReferralCheck => {
  const reward = rewardOf(draft.reward)
  const limitText = draft.limit.trim()
  const limit = /^\d{1,3}$/.test(limitText) ? Number(limitText) : null
  const goodLimit = limit !== null && limit >= 1 && limit <= REFERRAL_LIMIT_MAX ? limit : null
  const levels = levelsOf(draft.levels)

  if (!draft.enabled) {
    return {
      ok: true,
      settings: {
        enabled: false,
        reward: reward ?? 0,
        limit: goodLimit ?? REFERRAL_LIMIT_DEFAULT,
        levels: levels ?? [...NO_REFERRAL_LEVELS],
      },
    }
  }

  if (reward === null) {
    return { ok: false, problem: 'reward' }
  }

  if (levels === null) {
    return { ok: false, problem: 'levels' }
  }

  if (reward === 0 && !levels.some((pct) => pct > 0)) {
    return { ok: false, problem: 'nothing' }
  }

  if (goodLimit === null) {
    return { ok: false, problem: 'limit' }
  }

  return { ok: true, settings: { enabled: true, reward, limit: goodLimit, levels } }
}

/** Пример на чеке друга в 1 000 ฿: сколько получит каждый круг, в сатангах. */
export const levelsExample = (levels: ReferralLevels): readonly number[] =>
  levels.map((pct) => Math.floor((100_000 * pct) / 100))
