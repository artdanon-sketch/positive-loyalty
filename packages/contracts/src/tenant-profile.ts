import { z } from 'zod'

import { VenueVertical } from './partnership.js'

/**
 * Профиль заведения. docs/02, раздел 5.6.7 · docs/03, раздел 9.
 *
 * ЭТО НЕ НАСТРОЙКИ ПРОГРАММЫ, А ПАСПОРТ ЗАВЕДЕНИЯ: как оно называется, чем
 * занимается, где стоит и когда открыто. Программа лояльности работает и без
 * него, но гость видит именно это — в карте, в сообщениях, в предложении
 * партнёра.
 *
 * ЧАСОВОЙ ПОЯС И ЯЗЫК ЖИВУТ ЗДЕСЬ ЖЕ, потому что владелец ищет их там, где
 * название заведения, а не в отдельном разделе «системные настройки»: «день»
 * в отчётах считается по часам заведения, и ошибка в поясе сдвигает выручку.
 */

/** Часовой пояс проверяется тем же, кто его потом применит, — самой системой дат. */
const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })

    return true
  } catch {
    return false
  }
}

export const TenantLocale = z.enum(['ru', 'en', 'th'])
export type TenantLocale = z.infer<typeof TenantLocale>

export const TenantProfile = z
  .object({
    /** Как заведение называют гости. Это имя стоит в карте и в рассылках. */
    brandName: z.string().trim().min(2, 'Назовите заведение').max(80),
    /** Юридическое лицо — для документов. Гость его не видит. */
    legalName: z.string().trim().max(160).nullable().default(null),
    vertical: VenueVertical,
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isTimeZone, { error: 'Неизвестный часовой пояс' }),
    /** Язык по умолчанию: на нём пишем тем, у кого свой язык неизвестен. */
    locale: TenantLocale,
    /** Короткий рассказ о заведении для карты гостя. */
    about: z.string().trim().max(500).default(''),
    /** Телефон для гостя — не для входа и не для рассылок. */
    phone: z.string().trim().max(32).nullable().default(null),
    website: z.url('Ссылка должна начинаться с http').max(200).nullable().default(null),
    address: z.string().trim().max(200).default(''),
    /** Часы работы свободным текстом: «ежедневно 9:00–22:00». */
    hours: z.string().trim().max(120).default(''),
  })
  .strict()

export type TenantProfile = z.infer<typeof TenantProfile>

/**
 * Разбор того, что уже лежит в базе: мягче, чем сохранение.
 *
 * Заведение заводится раньше, чем владелец дошёл до профиля, и до тех пор
 * «пустой профиль» обязан читаться — иначе экран настроек падал бы у всех,
 * кто его ещё не заполнял.
 */
export const TenantProfileExtra = z
  .object({
    about: z.string().max(500).default(''),
    phone: z.string().max(32).nullable().default(null),
    website: z.string().max(200).nullable().default(null),
    address: z.string().max(200).default(''),
    hours: z.string().max(120).default(''),
  })
  .strict()

export type TenantProfileExtra = z.infer<typeof TenantProfileExtra>
