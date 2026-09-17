import { z } from 'zod'

/**
 * Что гость может изменить о себе. docs/02, раздел 2.12.
 *
 * ИМЯ И ЯЗЫК — И БОЛЬШЕ НИЧЕГО. Телефон меняется входом по новому номеру,
 * день рождения ставится один раз (раздел 2.7), а «турист или резидент» —
 * наблюдение системы, а не анкета: гость, переключивший себя в резиденты ради
 * условий получше, ломает не нам статистику, а себе предложения.
 *
 * ПУСТОЕ ИМЯ — ЭТО «НЕ ПРЕДСТАВИЛСЯ», А НЕ ПУСТАЯ СТРОКА. Кассир видит «Гость»,
 * и это честнее, чем безымянная строка в списке.
 */

export const GuestLocale = z.enum(['ru', 'en', 'th'])
export type GuestLocale = z.infer<typeof GuestLocale>

export const UpdateGuestProfileInput = z
  .object({
    /** Как обращаться. null — гость убрал имя. */
    displayName: z
      .string()
      .trim()
      .min(2, 'Имя слишком короткое')
      .max(60, 'Имя слишком длинное')
      .nullable(),
    /** Язык сообщений и карты. */
    locale: GuestLocale,
  })
  .strict()

export type UpdateGuestProfileInput = z.infer<typeof UpdateGuestProfileInput>
