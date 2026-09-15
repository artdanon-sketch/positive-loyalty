import { z } from 'zod'

import {
  ENGINE_OFFER_TYPES,
  OfferAudience,
  OfferLimits,
  OfferReward,
  OfferSchedule,
  REWARD_OF_TYPE,
} from './offer-rules.js'
import { OfferStatus } from './offer.js'

/**
 * Конструктор акций в бэк-офисе. docs/03, раздел 4 · docs/02, раздел 5.3.
 *
 * Шаблоны — дело экрана: они только заполняют форму. На сервер уходят сами
 * правила, те же, что читает движок кассы, — чтобы акция, собранная
 * конструктором, и акция, посчитанная на кассе, не могли разойтись.
 */

const Rules = z
  .object({
    type: z.enum(ENGINE_OFFER_TYPES),
    audience: OfferAudience.default({ kind: 'ALL' }),
    schedule: OfferSchedule.default({}),
    limits: OfferLimits.default({}),
    reward: OfferReward,
  })
  .strict()

type Rules = z.infer<typeof Rules>

const rewardFitsType = (rules: Rules): boolean => REWARD_OF_TYPE[rules.type] === rules.reward.kind

const REWARD_MISMATCH =
  'Кэшбэк начисляет баллы, промокод за чек выдаёт код — награда не подходит к типу акции'

const periodIsValid = (rules: Rules): boolean =>
  rules.schedule.startsAt === undefined ||
  rules.schedule.endsAt === undefined ||
  Date.parse(rules.schedule.endsAt) > Date.parse(rules.schedule.startsAt)

/**
 * Создать акцию. Только владелец: «создавать и менять акции» в матрице прав
 * docs/05 — его галочка.
 *
 * `launch: NOW` — сразу в работу, `DRAFT` — сохранить и вернуться. Уведомлений
 * гостям и витрины сети на третьем шаге нет: каналов и витрины ещё нет, а
 * переключатель, который ничего не делает, хуже отсутствующего.
 */
export const CreateOfferInput = Rules.extend({
  /** Название словами владельца: «Вернём 200 ฿». Его видит гость. */
  title: z.string().trim().min(2).max(80),
  stackable: z.boolean().default(true),
  priority: z.number().int().min(1).max(1000).default(100),
  launch: z.enum(['NOW', 'DRAFT']).default('NOW'),
})
  .strict()
  .refine(rewardFitsType, { error: REWARD_MISMATCH, path: ['reward'] })
  .refine(periodIsValid, {
    error: 'Акция должна закончиться позже, чем начнётся',
    path: ['schedule', 'endsAt'],
  })

export type CreateOfferInput = z.infer<typeof CreateOfferInput>

/** Прогноз до запуска — те же правила, без названия и порядка. */
export const SimulateOfferInput = Rules.refine(rewardFitsType, {
  error: REWARD_MISMATCH,
  path: ['reward'],
})

export type SimulateOfferInput = z.infer<typeof SimulateOfferInput>

/**
 * Прогноз «если бы эта акция шла последние 30 дней» (docs/10, раздел 5.3).
 *
 * Когда истории мало, цифр нет вовсе — только причина. Правдоподобное число
 * на экране, по которому владелец решает, запускать ли акцию, хуже честного
 * «данных пока мало».
 */
export const OfferSimulation = z.discriminatedUnion('insufficientData', [
  z.object({ insufficientData: z.literal(true), reason: z.string() }).strict(),
  z
    .object({
      insufficientData: z.literal(false),
      days: z.number().int().positive(),
      /** Гостей, которых акция затронула бы. */
      guests: z.number().int().nonnegative(),
      /** Промокодов выдала бы. null — кэшбэк: кодов он не выдаёт. */
      grants: z.number().int().nonnegative().nullable(),
      /** Баллов сверх базовой ставки. null — промокод за чек: баллов он не начисляет. */
      bonusPoints: z.number().int().nonnegative().nullable(),
      /**
       * Во что обошлась бы, в минорных единицах: баллы кэшбэка или скидка
       * в батах по всем кодам. null — подарок вещью или процентом: его цену
       * знает только заведение.
       */
      cost: z.number().int().nonnegative().nullable(),
    })
    .strict(),
])

export type OfferSimulation = z.infer<typeof OfferSimulation>

/** Ответ на создание и смену статуса. Цифры и кнопки экран берёт из списка. */
export const OfferChangeResult = z.object({ id: z.uuid(), status: OfferStatus }).strict()

export type OfferChangeResult = z.infer<typeof OfferChangeResult>
