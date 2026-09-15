import { REFERRAL_LIMIT_MAX, REFERRAL_REWARD_MAX } from '@positive/contracts'
import type { ReferralSettings } from '@positive/contracts'

import { bahtToMinor } from '../../shared/format/baht-input'

/**
 * Черновик приглашений друзей на экране настроек. docs/02, раздел 5.6.2.
 *
 * ПОЛЯ — СТРОКИ, НАСТРОЙКИ — ЧИСЛА. Баллы за друга владелец набирает в батах,
 * в сатанги они переводятся здесь (железное правило 4).
 *
 * ВЫКЛЮЧЕНО — ЧИНИТЬ НЕЧЕГО. Поля суммы и лимита при выключенных приглашениях
 * спрятаны, и проблема в невидимом поле заперла бы кнопку навсегда. Поэтому
 * выключенные сохраняются всегда: годное значение — как есть, негодное — нулём
 * и лимитом по умолчанию.
 */

export const REFERRAL_LIMIT_DEFAULT = 10

export interface ReferralDraft {
  readonly enabled: boolean
  readonly reward: string
  readonly limit: string
}

export type ReferralProblem = 'reward' | 'limit'

export type ReferralCheck =
  | { readonly ok: true; readonly settings: ReferralSettings }
  | { readonly ok: false; readonly problem: ReferralProblem }

export const toReferralDraft = (settings: ReferralSettings): ReferralDraft => ({
  enabled: settings.enabled,
  reward: settings.reward === 0 ? '' : String(settings.reward / 100),
  limit: String(settings.limit),
})

export const fromReferralDraft = (draft: ReferralDraft): ReferralCheck => {
  const reward = draft.reward.trim() === '' ? 0 : bahtToMinor(draft.reward)
  const limitText = draft.limit.trim()
  const limit = /^\d{1,3}$/.test(limitText) ? Number(limitText) : null

  const goodReward = reward !== null && reward <= REFERRAL_REWARD_MAX ? reward : null
  const goodLimit = limit !== null && limit >= 1 && limit <= REFERRAL_LIMIT_MAX ? limit : null

  if (!draft.enabled) {
    return {
      ok: true,
      settings: {
        enabled: false,
        reward: goodReward ?? 0,
        limit: goodLimit ?? REFERRAL_LIMIT_DEFAULT,
      },
    }
  }

  if (goodReward === null || goodReward === 0) {
    return { ok: false, problem: 'reward' }
  }

  if (goodLimit === null) {
    return { ok: false, problem: 'limit' }
  }

  return { ok: true, settings: { enabled: true, reward: goodReward, limit: goodLimit } }
}
