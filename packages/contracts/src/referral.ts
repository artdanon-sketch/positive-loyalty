import { z } from 'zod'

/**
 * Приглашения друзей — реферальная программа первого уровня.
 * docs/02, разделы 2.5 и 5.6.2 · docs/11, У6 · docs/05, раздел 6.2.
 *
 * ОДИН УРОВЕНЬ. Баллы получает тот, кто пригласил, и только за своего друга.
 * Цепочки «5 / 3 / 1 % вглубь» — это MLM, а не лояльность.
 *
 * НАГРАДА ДОЗРЕВАЕТ ПОКУПКОЙ. Баллы приходят, когда друг впервые купил, а не когда
 * вступил: ферма аккаунтов, которая только регистрируется, ничего не получает.
 */

/** Потолок награды: 10 000 ฿ за одного друга — опечатка, а не щедрость. */
export const REFERRAL_REWARD_MAX = 1_000_000

/** Потолок наград на одного гостя. Сотня друзей в одном заведении — уже не друзья. */
export const REFERRAL_LIMIT_MAX = 100

/** Восемь знаков: код диктуют и набирают руками, а перебирать его бессмысленно. */
export const REFERRAL_CODE_LENGTH = 8

/**
 * Код приглашения. Алфавит без 0, O, 1, I и L — тот же, что у промокодов.
 * Регистр не важен: «7kq2mx4p», набранный с телефона, — тот же код.
 */
export const ReferralCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[2-9A-HJKMNP-Z]{8}$/, 'Код приглашения — восемь букв и цифр')

/** Настройки приглашений, как их сохраняет владелец. */
export const ReferralSettings = z
  .object({
    enabled: z.boolean(),
    /** Баллы пригласившему за друга, в минорных единицах. */
    reward: z.number().int().nonnegative().max(REFERRAL_REWARD_MAX),
    /** Сколько наград может получить один гость. */
    limit: z.number().int().min(1).max(REFERRAL_LIMIT_MAX),
  })
  .strict()
  .refine((settings) => !settings.enabled || settings.reward > 0, {
    error: 'Включённая награда за друга не может быть нулём',
    path: ['reward'],
  })

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
    /** Баллы за друга, в минорных единицах. 0 — приглашать нельзя. */
    reward: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    /** Сколько друзей пришло по ссылке. */
    invited: z.number().int().nonnegative(),
    /** За скольких уже получены баллы. */
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
    /** За скольких он получил баллы. */
    rewarded: z.number().int().nonnegative(),
  })
  .strict()

export type AdminGuestReferral = z.infer<typeof AdminGuestReferral>
