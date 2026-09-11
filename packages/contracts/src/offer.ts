import { z } from 'zod'

/**
 * Тексты акции по языкам. Хранятся в `Offer.i18n`.
 *
 * ПОЧЕМУ РАЗБОР СНИСХОДИТЕЛЬНЫЙ. Это не тело запроса, а колонка, которая уже
 * существует и у всех нынешних акций равна `{}`. Строгая схема означала бы,
 * что промокод нельзя ни погасить, ни показать гостю, пока кто-то не заполнит
 * тексты — то есть отсутствие названия ломало бы выдачу подарка.
 *
 * Поэтому «названия нет» — допустимое состояние, а не ошибка. Отвечает за это
 * `offerTitle`: он возвращает `null`, и вызывающий сам решает, что показать.
 *
 * Пхукет четырёхъязычен (docs/04): русский, английский, тайский, китайский.
 * Поэтому тексты хранятся картой «язык → строка», а не одной строкой.
 */
export const OfferI18n = z.object({
  /** Название: `{ ru: 'Ролл в подарок', en: 'Free roll' }`. */
  title: z.record(z.string(), z.string()).optional(),
  /**
   * Как воспользоваться — по шагам. Приходит с сервера, а не собирается
   * на клиенте: иначе четыре языка разъедутся (docs/02, раздел 2.1).
   */
  howTo: z.record(z.string(), z.array(z.string())).optional(),
})

export type OfferI18n = z.infer<typeof OfferI18n>

/** Языки, на которые падаем, если нужного нет. Порядок намеренный. */
const FALLBACK_LOCALES = ['ru', 'en'] as const

/**
 * Достать текст на нужном языке.
 *
 * ЦЕПОЧКА ЗАПАСНЫХ ВАРИАНТОВ, А НЕ ПУСТАЯ СТРОКА. Гость-китаец, которому
 * не перевели название, должен увидеть его по-английски, а не пустоту:
 * пустое название превращает подарок в загадку, а перевод — дело поправимое
 * и заведомо отстающее.
 *
 * `null` — текста нет ни на одном языке. Это честный ответ, и вызывающий
 * обязан его обработать: подставить своё или не показывать поле вовсе.
 */
const pick = (map: Record<string, string> | undefined, locale: string): string | null => {
  if (map === undefined) {
    return null
  }

  const exact = map[locale]

  if (typeof exact === 'string' && exact.trim() !== '') {
    return exact
  }

  for (const fallback of FALLBACK_LOCALES) {
    const value = map[fallback]

    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }

  const any = Object.values(map).find((value) => value.trim() !== '')

  return any ?? null
}

/** Название акции на нужном языке. `null` — названия нет вовсе. */
export const offerTitle = (i18n: unknown, locale: string): string | null => {
  const parsed = OfferI18n.safeParse(i18n)

  return parsed.success ? pick(parsed.data.title, locale) : null
}

/** Шаги «как воспользоваться». Пустой список — шагов нет. */
export const offerHowTo = (i18n: unknown, locale: string): readonly string[] => {
  const parsed = OfferI18n.safeParse(i18n)

  if (!parsed.success || parsed.data.howTo === undefined) {
    return []
  }

  const map = parsed.data.howTo
  const exact = map[locale]

  if (Array.isArray(exact) && exact.length > 0) {
    return exact
  }

  for (const fallback of FALLBACK_LOCALES) {
    const value = map[fallback]

    if (Array.isArray(value) && value.length > 0) {
      return value
    }
  }

  return []
}
