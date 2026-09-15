import { z } from 'zod'

/**
 * Подарок ко дню рождения. docs/02, разделы 2.7 и 5.6.3 · docs/11, У9.
 *
 * Баллы или сертификат из шаблона — в окне «за N дней до и N дней после».
 * Выдаётся сам, когда гость открывает кошелёк или показывает код на кассе,
 * один раз в год на заведение.
 */

/** Окно шире двух недель — это уже не день рождения, а месяц подарков. */
export const BIRTHDAY_WINDOW_MAX_DAYS = 14

/** Потолок баллов: 10 000 ฿ ко дню рождения — опечатка, а не щедрость. */
export const BIRTHDAY_POINTS_MAX = 1_000_000

export const BirthdayReward = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('POINTS'),
      /** Баллы в минорных единицах. */
      amount: z.number().int().positive().max(BIRTHDAY_POINTS_MAX),
    })
    .strict(),
  z
    .object({
      kind: z.literal('CERTIFICATE'),
      certificateId: z.uuid(),
    })
    .strict(),
])

export type BirthdayReward = z.infer<typeof BirthdayReward>

const WindowDays = z.number().int().min(0).max(BIRTHDAY_WINDOW_MAX_DAYS)

/** Настройки, как их сохраняет владелец. */
export const BirthdaySettings = z
  .object({
    enabled: z.boolean(),
    reward: BirthdayReward,
    daysBefore: WindowDays,
    daysAfter: WindowDays,
  })
  .strict()

export type BirthdaySettings = z.infer<typeof BirthdaySettings>

/**
 * Разбор того, что лежит в базе, — мягче: старые настройки без ключа читаются
 * как «выключено» с разумным окном.
 */
export const BirthdayConfig = z
  .object({
    enabled: z.boolean().default(false),
    reward: BirthdayReward.default({ kind: 'POINTS', amount: 10_000 }),
    daysBefore: WindowDays.default(3),
    daysAfter: WindowDays.default(3),
  })
  .strict()

export type BirthdayConfig = z.infer<typeof BirthdayConfig>

/**
 * День рождения, который гость указывает сам. Один раз: иначе подарок можно было бы
 * получать каждый месяц, меняя дату.
 */
export const GuestBirthdayInput = z
  .object({
    /** `YYYY-MM-DD`. Не из будущего и не раньше 1900 года. */
    date: z.iso.date(),
  })
  .strict()
  .refine(
    (input) => {
      const date = new Date(`${input.date}T00:00:00.000Z`)
      return date.getUTCFullYear() >= 1900 && date.getTime() <= Date.now()
    },
    { error: 'Дата рождения — не из будущего', path: ['date'] },
  )

export type GuestBirthdayInput = z.infer<typeof GuestBirthdayInput>
