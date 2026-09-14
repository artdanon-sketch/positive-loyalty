import { z } from 'zod'

/**
 * Правила акции: кому, когда, сколько и что. docs/01, раздел 4.5 · docs/03, раздел 4.
 *
 * Лежат в колонках Offer (audience, schedule, limits, reward) и читаются
 * движком правил на каждом предрасчёте кассы.
 *
 * ТОЛЬКО ТО, ЧТО РАБОТАЕТ. Здесь две механики, которые движок проводит
 * до конца: кэшбэк сверх базовой ставки и промокод за чек. Скидка в самом
 * чеке, штампы и статусы появятся со своими механиками — описать их заранее
 * значило бы разрешить владельцу настроить акцию, которая ни разу не сработает.
 */

/** Типы акций, которые считает движок. Партнёрские и подарки из карточки гостя — нет. */
export const ENGINE_OFFER_TYPES = ['CASHBACK', 'PROMO_ON_CHECK'] as const
export type EngineOfferType = (typeof ENGINE_OFFER_TYPES)[number]

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ')

/** Кому. «Спящие» — те, кто не был в заведении дольше указанного числа дней. */
export const OfferAudience = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }).strict(),
  z.object({ kind: z.literal('NEW') }).strict(),
  z.object({ kind: z.literal('TOURIST') }).strict(),
  z.object({ kind: z.literal('RESIDENT') }).strict(),
  z
    .object({ kind: z.literal('SLEEPING'), notVisitedDays: z.number().int().min(7).max(365) })
    .strict(),
])

export type OfferAudience = z.infer<typeof OfferAudience>

/**
 * Когда. Всё необязательно: без расписания акция идёт, пока она запущена.
 *
 * Дни недели и окно — по часам ЗАВЕДЕНИЯ, а не сервера и не кассы
 * (docs/03, раздел 4: акция «до 17:00» неприменима в 17:05 даже при
 * подделанных часах на планшете). Окно полуоткрытое: с 14:00 до 17:00 —
 * это 16:59 да, 17:00 уже нет.
 */
export const OfferSchedule = z
  .object({
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    /** ISO: 1 — понедельник, 7 — воскресенье. */
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    timeWindow: z
      .object({ from: ClockTime, to: ClockTime })
      .strict()
      .refine(
        (window) => window.from !== window.to,
        'Окно не может начинаться и кончаться в одну минуту',
      )
      .optional(),
  })
  .strict()

export type OfferSchedule = z.infer<typeof OfferSchedule>

/** Сколько. Суммы — целые в минорных единицах (железное правило 4). */
export const OfferLimits = z
  .object({
    /** Чек от — сумма чека до списания баллов. */
    minCheck: z.number().int().positive().nullable().optional(),
    /** Промокодов одному гостю. */
    perGuestQty: z.number().int().positive().nullable().optional(),
    /** Промокодов всего. */
    totalQty: z.number().int().positive().nullable().optional(),
  })
  .strict()

export type OfferLimits = z.infer<typeof OfferLimits>

/** Что даёт промокод при погашении. Касса отдаёт это сама, как партнёрский подарок. */
export const GiftValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FREE_ITEM'), itemName: z.string().trim().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('FIXED_OFF'), amount: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal('PERCENT_OFF'),
      percent: z.number().int().min(1).max(100),
      maxDiscount: z.number().int().positive().nullable(),
    })
    .strict(),
])

export type GiftValue = z.infer<typeof GiftValue>

/** Что гость получает за чек. */
export const OfferReward = z.discriminatedUnion('kind', [
  /** Кэшбэк: процент от оплаченного деньгами — сверх базовой ставки заведения. */
  z.object({ kind: z.literal('EARN_PERCENT'), percent: z.number().int().min(1).max(50) }).strict(),
  /** Промокод за чек: выдаётся после оплаты, не заранее (docs/03, раздел 4). */
  z
    .object({
      kind: z.literal('GIFT_CODE'),
      gift: GiftValue,
      validityDays: z.number().int().min(1).max(90),
    })
    .strict(),
])

export type OfferReward = z.infer<typeof OfferReward>

/** Какая награда какому типу положена: кэшбэк не выдаёт кодов, промокод не начисляет баллов. */
export const REWARD_OF_TYPE: Readonly<Record<EngineOfferType, OfferReward['kind']>> = {
  CASHBACK: 'EARN_PERCENT',
  PROMO_ON_CHECK: 'GIFT_CODE',
}

/**
 * Почему акция не применилась. docs/01, раздел 4.5 — плюс три причины, без
 * которых кассиру нечего сказать: акция не в своём расписании, гость
 * в контрольной группе, акция настроена с ошибкой.
 */
export const OfferSkipReason = z.enum([
  'MISCONFIGURED',
  'CONTROL_GROUP',
  'SCHEDULE',
  'TIME_WINDOW',
  'AUDIENCE',
  'LIMIT_REACHED',
  'MIN_CHECK',
  'NOT_STACKABLE',
])

export type OfferSkipReason = z.infer<typeof OfferSkipReason>

/** Применённая акция в предрасчёте кассы. */
export const AppliedOffer = z
  .object({
    offerId: z.uuid(),
    title: z.string().nullable(),
    /** Баллов сверх базовой ставки. */
    earnDelta: z.number().int().nonnegative(),
    /** Скидка в самом чеке. Пока всегда ноль: таких механик ещё нет. */
    discountDelta: z.number().int().nonnegative(),
    /** Промокод выдастся после оплаты. */
    grantAfterPayment: z.boolean(),
  })
  .strict()

export type AppliedOffer = z.infer<typeof AppliedOffer>

/** Не применившаяся акция — с тем, что кассир скажет гостю. */
export const SkippedOffer = z
  .object({
    offerId: z.uuid(),
    title: z.string().nullable(),
    reason: OfferSkipReason,
    message: z.string(),
  })
  .strict()

export type SkippedOffer = z.infer<typeof SkippedOffer>

/**
 * Промокод, выданный за чек.
 *
 * Кассе — только последние четыре знака, как и бэк-офису у подарков из
 * карточки гостя. Полный код видит гость в своём приложении: касса, знающая
 * коды, могла бы гасить их сама.
 */
export const IssuedGrant = z
  .object({
    grantId: z.uuid(),
    offerId: z.uuid(),
    title: z.string().nullable(),
    codeTail: z.string().max(4),
    expiresAt: z.iso.datetime(),
  })
  .strict()

export type IssuedGrant = z.infer<typeof IssuedGrant>
