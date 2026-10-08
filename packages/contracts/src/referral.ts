import { z } from 'zod'

import { HUMAN_CODE_LENGTH, HumanCode } from './code.js'

/**
 * Приглашения друзей. docs/02, разделы 2.5 и 5.6.2 · docs/11, У6 · docs/05, раздел 6.2.
 *
 * ДВЕ НАГРАДЫ, ОБЕ ДОЗРЕВАЮТ ПОКУПКОЙ:
 *
 * - разовая (`reward`) — пригласившему, когда друг впервые купил, а не когда
 *   вступил: ферма аккаунтов, которая только регистрируется, ничего не получает;
 * - процент с покупок (`levels`) — с каждой покупки друга, до трёх кругов вглубь:
 *   пригласившему, его пригласившему и следующему. Как у UDS.
 *
 * ТРИ УРОВНЯ — РЕШЕНИЕ ВЛАДЕЛЬЦА 08.10.2026, вопреки первоначальному «не повторяем,
 * это MLM» (docs/05, раздел 6.2). Поэтому по умолчанию проценты нулевые: заведение
 * включает их само, видя, что делает. Отменённый чек забирает проценты обратно.
 */

/** Потолок награды: 10 000 ฿ за одного друга — опечатка, а не щедрость. */
export const REFERRAL_REWARD_MAX = 1_000_000

/** Потолок наград на одного гостя. Сотня друзей в одном заведении — уже не друзья. */
export const REFERRAL_LIMIT_MAX = 100

/** Сколько кругов вглубь платит процент с покупок: друг, друг друга, третий круг. */
export const REFERRAL_LEVELS = 3

/** Потолок процента на одном круге. Больше — заведение раздаёт выручку, а не баллы. */
export const REFERRAL_LEVEL_PCT_MAX = 20

/** Проценты с покупок по кругам — первый, второй, третий. */
export const ReferralLevels = z
  .array(z.number().min(0).max(REFERRAL_LEVEL_PCT_MAX))
  .length(REFERRAL_LEVELS)

export type ReferralLevels = z.infer<typeof ReferralLevels>

/** Проценты выключены: так у заведения, которое их не включало. */
export const NO_REFERRAL_LEVELS: ReferralLevels = [0, 0, 0]

/** Восемь знаков: код диктуют и набирают руками, а перебирать его бессмысленно. */
export const REFERRAL_CODE_LENGTH = HUMAN_CODE_LENGTH

/**
 * Код приглашения. Алфавит без 0, O, 1, I и L — тот же, что у промокодов.
 * Регистр не важен: «7kq2mx4p», набранный с телефона, — тот же код.
 */
export const ReferralCode = HumanCode

/** Настройки приглашений, как их сохраняет владелец. */
export const ReferralSettings = z
  .object({
    enabled: z.boolean(),
    /** Баллы пригласившему за друга, в минорных единицах. */
    reward: z.number().int().nonnegative().max(REFERRAL_REWARD_MAX),
    /** Сколько разовых наград может получить один гость. На проценты не влияет. */
    limit: z.number().int().min(1).max(REFERRAL_LIMIT_MAX),
    /**
     * Процент с каждой покупки друга по кругам. НЕОБЯЗАТЕЛЬНОЕ ПОЛЕ: клиент, который
     * о процентах не знает, сохраняет остальное и включённые проценты не сбрасывает.
     */
    levels: ReferralLevels.optional(),
  })
  .strict()
  .refine(
    (settings) =>
      !settings.enabled ||
      settings.reward > 0 ||
      (settings.levels ?? NO_REFERRAL_LEVELS).some((pct) => pct > 0),
    {
      error: 'Включённые приглашения должны что-то давать: разовую награду или процент',
      path: ['reward'],
    },
  )

export type ReferralSettings = z.infer<typeof ReferralSettings>

/** «Пригласить друга» в приложении гостя — по одному заведению. */
export const GuestReferral = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string(),
    /**
     * Приглашать можно: программа включена и гостю положены баллы. false — кода
     * нет, и экран не показывает ссылку, которая ничего не принесёт.
     */
    enabled: z.boolean(),
    code: z.string().nullable(),
    /** Разовые баллы за друга, в минорных единицах. 0 — разовой награды нет. */
    reward: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    /** Процент с покупок друзей по кругам. Нули — процентов нет. */
    levels: ReferralLevels,
    /** Сколько друзей пришло по ссылке. */
    invited: z.number().int().nonnegative(),
    /** За скольких уже получена разовая награда. */
    rewarded: z.number().int().nonnegative(),
  })
  .strict()

export type GuestReferral = z.infer<typeof GuestReferral>

export const AcceptReferralInput = z
  .object({
    code: ReferralCode,
  })
  .strict()

export type AcceptReferralInput = z.infer<typeof AcceptReferralInput>

export const AcceptReferralResult = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string(),
    /** false — гость уже был гостем заведения: приглашение ничего не меняет. */
    joined: z.boolean(),
  })
  .strict()

export type AcceptReferralResult = z.infer<typeof AcceptReferralResult>

/** Приглашения в карточке гостя в бэк-офисе. */
export const AdminGuestReferral = z
  .object({
    /** Кто привёл этого гостя. null — пришёл сам. */
    invitedBy: z
      .object({
        guestId: z.uuid(),
        displayName: z.string().nullable(),
      })
      .strict()
      .nullable(),
    /** Сколько друзей пришло по его ссылке. */
    invited: z.number().int().nonnegative(),
    /** За скольких он получил разовую награду. */
    rewarded: z.number().int().nonnegative(),
  })
  .strict()

export type AdminGuestReferral = z.infer<typeof AdminGuestReferral>
