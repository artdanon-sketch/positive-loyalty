import { z } from 'zod'

/**
 * Партнёрства между заведениями: триггеры и награды. docs/07, раздел 4.
 *
 * Здесь описано ЧТО должно случиться у заведения-источника и ЧТО за это
 * получит гость у заведения-донора. Обе стороны согласовывают именно эти
 * два объекта — поэтому они и живут в контрактах, а не в коде одного модуля.
 */

/**
 * Что должно произойти у заведения-источника.
 *
 * Разбор по полю `type` (discriminatedUnion), а не по набору необязательных
 * полей: иначе условие «покупка от 5000» и условие «третий визит» отличались бы
 * лишь тем, какое поле заполнено, и опечатка молча превращала бы одно в другое.
 */
export const PartnershipTrigger = z.discriminatedUnion('type', [
  /** Чек не меньше суммы. Сумма в минорных единицах (сатангах). */
  z.object({ type: z.literal('ON_PURCHASE'), minAmount: z.number().int().min(0) }),
  /** Первый визит гостя в это заведение. */
  z.object({ type: z.literal('ON_FIRST_VISIT') }),
  /** N-й визит. Со второго: первый — это ON_FIRST_VISIT. */
  z.object({ type: z.literal('ON_NTH_VISIT'), n: z.number().int().min(2) }),
  /** Купил абонемент или пакет. Отличается от ON_PURCHASE происхождением записи. */
  z.object({ type: z.literal('ON_PACKAGE_PURCHASE'), minAmount: z.number().int().min(0) }),
  /** Закрыл штамп-карту. */
  z.object({ type: z.literal('ON_STAMP_COMPLETE') }),
  /** Достиг статуса. */
  z.object({ type: z.literal('ON_TIER_REACHED'), tierId: z.string().min(1) }),
  /** Просто стал гостем партнёра. */
  z.object({ type: z.literal('ON_MEMBERSHIP') }),
])

export type PartnershipTrigger = z.infer<typeof PartnershipTrigger>

/**
 * Что гость получит у заведения-донора.
 *
 * Все суммы — целые в минорных единицах (железное правило 4). Награду
 * оплачивает тот, кто её даёт: расчётов между заведениями нет никогда.
 */
export const PartnershipReward = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FREE_ITEM'),
    itemName: z.string().min(1).max(200),
    /** Минимальный чек, при котором подарок выдаётся. */
    minCheck: z.number().int().min(0).default(0),
  }),
  z.object({ kind: z.literal('FIXED_POINTS'), amount: z.number().int().positive() }),
  z.object({
    kind: z.literal('PERCENT_OFF'),
    percent: z.number().min(1).max(100),
    /** Потолок скидки. null — без потолка. */
    maxDiscount: z.number().int().positive().nullable(),
  }),
  z.object({
    kind: z.literal('FIXED_OFF'),
    amount: z.number().int().positive(),
    minCheck: z.number().int().min(0).default(0),
  }),
  z.object({ kind: z.literal('GIFT_STAMPS'), count: z.number().int().min(1) }),
])

export type PartnershipReward = z.infer<typeof PartnershipReward>

/**
 * Ограничения условия.
 *
 * `dailyCap` — не украшение. Без него заведение-источник проводит акцию
 * и присылает донору двести человек за бесплатными роллами за один день
 * (docs/07, раздел 4.3).
 */
export const PartnershipLimits = z
  .object({
    /** Сколько всего промокодов выдать по этому условию. null — без ограничения. */
    totalGrants: z.number().int().positive().nullable().default(null),
    /** Сколько раз один и тот же гость может получить награду. */
    perGuest: z.number().int().positive().default(1),
    /** Сколько промокодов в сутки. null — без ограничения. */
    dailyCap: z.number().int().positive().nullable().default(null),
  })
  .strict()

export type PartnershipLimits = z.infer<typeof PartnershipLimits>
