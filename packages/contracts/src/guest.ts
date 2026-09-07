import { z } from 'zod'

/**
 * Гостевой контур: вход по коду и кошелёк.
 * docs/02, разделы 1.1–1.2 и 2.1.
 */

/** Канал доставки кода. SMS появится с провайдером; DEV — код в лог сервера. */
export const OtpChannel = z.enum(['DEV', 'SMS', 'TELEGRAM', 'LINE'])
export type OtpChannel = z.infer<typeof OtpChannel>

export const OtpRequestInput = z
  .object({
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Телефон в формате E.164, например +66812345678'),
    channel: OtpChannel.default('DEV'),
  })
  .strict()

export type OtpRequestInput = z.infer<typeof OtpRequestInput>

export const OtpRequestResult = z
  .object({
    requestId: z.uuid(),
    /** Секунды жизни кода. */
    expiresIn: z.number().int().positive(),
    /** Раньше этого не повторять запрос. */
    resendAfter: z.number().int().positive(),
    /**
     * Код подтверждения — ТОЛЬКО вне production, для разработки без SMS.
     * В боевом окружении поле отсутствует всегда; это проверяет тест.
     */
    devCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()

export type OtpRequestResult = z.infer<typeof OtpRequestResult>

export const OtpVerifyInput = z
  .object({
    requestId: z.uuid(),
    code: z.string().regex(/^\d{6}$/, 'Код — шесть цифр'),
  })
  .strict()

export type OtpVerifyInput = z.infer<typeof OtpVerifyInput>

export const GuestProfile = z
  .object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    mode: z.enum(['TOURIST', 'RESIDENT']),
    locale: z.string().min(2).max(5),
  })
  .strict()

export type GuestProfile = z.infer<typeof GuestProfile>

export const GuestAuthResult = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().int().positive(),
    guest: GuestProfile,
    /** Гость создан этим входом — приветствие и онбординг показываются один раз. */
    isNew: z.boolean(),
  })
  .strict()

export type GuestAuthResult = z.infer<typeof GuestAuthResult>

export const GuestRefreshInput = z.object({ refreshToken: z.string().min(32).max(1024) }).strict()

export type GuestRefreshInput = z.infer<typeof GuestRefreshInput>

/** Участие в кошельке: заведение и баллы в нём. */
export const WalletMembership = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string().min(1),
    points: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    lastVisitAt: z.iso.datetime().nullable(),
    isControlGroup: z.boolean(),
  })
  .strict()

export const GuestWallet = z
  .object({
    /** Сумма баллов по всем заведениям — крупная цифра на карте. */
    totalPoints: z.number().int(),
    memberships: z.array(WalletMembership),
  })
  .strict()

export type GuestWallet = z.infer<typeof GuestWallet>

export const GuestMe = GuestProfile.extend({
  /** Маскированный телефон: «+66 •• •• 4821». Полный гостю не нужен — он свой знает. */
  /** null — гость вошёл через аккаунт и номер не оставлял. */
  phoneMasked: z.string().min(1).nullable(),
}).strict()

export type GuestMe = z.infer<typeof GuestMe>

/** Токен для показа на кассе. */
export const GuestQrToken = z
  .object({
    token: z.string().min(1),
    expiresIn: z.number().int().positive(),
  })
  .strict()

export type GuestQrToken = z.infer<typeof GuestQrToken>
