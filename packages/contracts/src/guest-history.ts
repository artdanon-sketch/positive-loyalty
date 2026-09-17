import { z } from 'zod'

import { LedgerType } from './ledger.js'

/**
 * История операций гостя. docs/02, раздел 2.11.
 *
 * ЗАЧЕМ. Карта показывает, СКОЛЬКО баллов, и молчит о том, ЗА ЧТО. Пока цифра
 * растёт, вопросов нет; спор начинается у стойки, когда гость уверен, что баллов
 * было больше. История — единственный ответ на «а куда делось»: те же записи,
 * что видит владелец в бэк-офисе, только свои.
 *
 * ОДНА ЛЕНТА НА ВСЕ ЗАВЕДЕНИЯ, как и кошелёк: карта общая, и раскладывать одну
 * историю по вкладкам заведений значит заставить гостя искать, в каком из них
 * была операция, которую он и так помнит по дате.
 *
 * ОТМЕНЁННЫЕ ЧЕКИ ВИДНЫ. Убрать их из истории — значит соврать: гость помнит
 * начисление, которого «вдруг» не стало. Отмена приходит своей строкой.
 */

/** Сколько записей отдаём за раз. Дальше — «показать ещё». */
export const GUEST_HISTORY_PAGE = 20

export const GuestHistoryEntry = z
  .object({
    id: z.uuid(),
    /** Когда операция произошла (а не когда мы о ней узнали). */
    at: z.iso.datetime(),
    tenantId: z.uuid(),
    /** Имя заведения: в общей ленте без него запись не читается. */
    venue: z.string(),
    type: LedgerType,
    /** Знаковое: + начисление, − списание. */
    points: z.number().int(),
    /** Сумма чека в минорных единицах. null — операция без чека. */
    basisAmount: z.number().int().nullable(),
    /** Баланс в этом заведении после операции. */
    balanceAfter: z.number().int(),
  })
  .strict()

export type GuestHistoryEntry = z.infer<typeof GuestHistoryEntry>

export const GuestHistory = z
  .object({
    items: z.array(GuestHistoryEntry),
    /** Есть ли что показывать дальше. Общее число не считаем: оно не нужно. */
    hasMore: z.boolean(),
  })
  .strict()

export type GuestHistory = z.infer<typeof GuestHistory>

export const GuestHistoryQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(GUEST_HISTORY_PAGE).default(GUEST_HISTORY_PAGE),
    offset: z.coerce.number().int().min(0).default(0),
    /** Только это заведение. Пусто — все. */
    tenantId: z.uuid().optional(),
  })
  .strict()

export type GuestHistoryQuery = z.infer<typeof GuestHistoryQuery>
