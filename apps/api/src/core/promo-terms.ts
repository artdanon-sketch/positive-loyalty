import { OfferLimits, OfferSchedule } from '@positive/contracts'
import type { PromoTerms } from '@positive/contracts'

/**
 * Условия промо-сертификата в полях самой акции. docs/02, раздел 5.11.
 *
 * Окно «забрать» живёт в `schedule.startsAt/endsAt`, тираж — в `limits.totalQty`:
 * промо — надстройка над Offer, а не новая сущность. Остальные ключи расписания
 * и лимитов (окно по времени суток, «в одни руки») сохраняются как были:
 * правка тиража не должна стирать то, чего на экране промо не видно.
 *
 * ЧИСТЫЕ ФУНКЦИИ — границы «ровно в момент конца» проверяются юнит-тестом.
 */

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}

/** Условия промо из полей акции. Неразборчивое — как отсутствующее. */
export const termsOf = (schedule: unknown, limits: unknown): PromoTerms => {
  const window = OfferSchedule.safeParse(schedule)
  const cap = OfferLimits.safeParse(limits)

  return {
    startsAt: window.success ? (window.data.startsAt ?? null) : null,
    endsAt: window.success ? (window.data.endsAt ?? null) : null,
    limit: cap.success ? (cap.data.totalQty ?? null) : null,
  }
}

/** Расписание с новым окном промо; прочие ключи — как были. */
export const scheduleWith = (schedule: unknown, terms: PromoTerms): Record<string, unknown> => {
  const next = record(schedule)
  delete next['startsAt']
  delete next['endsAt']

  return {
    ...next,
    ...(terms.startsAt === null ? {} : { startsAt: terms.startsAt }),
    ...(terms.endsAt === null ? {} : { endsAt: terms.endsAt }),
  }
}

/** Лимиты с новым тиражом; прочие ключи — как были. */
export const limitsWith = (limits: unknown, terms: PromoTerms): Record<string, unknown> => {
  const next = record(limits)
  delete next['totalQty']

  return { ...next, ...(terms.limit === null ? {} : { totalQty: terms.limit }) }
}

/**
 * Открыто ли окно «забрать». Границы — как у движка акций: в момент начала
 * уже можно, в момент конца ещё можно.
 */
export const promoOpen = (terms: PromoTerms, now: Date): boolean =>
  (terms.startsAt === null || now.getTime() >= Date.parse(terms.startsAt)) &&
  (terms.endsAt === null || now.getTime() <= Date.parse(terms.endsAt))

/** Сколько осталось при тираже. null — тиража нет. */
export const promoLeft = (terms: PromoTerms, issued: number): number | null =>
  terms.limit === null ? null : Math.max(0, terms.limit - issued)
