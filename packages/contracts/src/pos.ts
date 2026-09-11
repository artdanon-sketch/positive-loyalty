import { z } from 'zod'

import { ReversalReason } from './ledger.js'

/**
 * Контракты кассы. docs/02_API_контракты.md, раздел 3.
 *
 * ЧЕГО ЗДЕСЬ ПОКА НЕТ И ПОЧЕМУ. В ТЗ ответы богаче: `appliedOffers`,
 * `skippedOffers`, `availableGrants`, `stamps`, `staffReward`, `riskLevel`.
 * Всё это опирается на движок правил, модели Offer/OfferGrant и risk-модуль —
 * Срезы 3 и 5. Выдумывать эти поля пустыми сейчас нельзя: касса начала бы
 * показывать «акций нет» там, где их не искали, и кассир объяснял бы гостю
 * несуществующее правило.
 *
 * Поэтому здесь честный подмножественный контракт, а не заглушки. Поля приедут
 * вместе с механикой, которая их наполняет.
 */

/** Как гость расплатился. Нужно отчётности и разбору спорных операций. */
export const PaidBy = z.enum(['CASH', 'CARD', 'PROMPTPAY', 'OTHER'])
export type PaidBy = z.infer<typeof PaidBy>

export const GuestMode = z.enum(['TOURIST', 'RESIDENT'])
export type GuestMode = z.infer<typeof GuestMode>

/**
 * Поиск гостя на кассе.
 *
 * Ровно один из способов: токен с экрана гостя либо телефон вручную.
 * Ручной ввод разрешён только при `cashierRules.allowManualEntry` — иначе
 * кассир оформляет гостей по чужим номерам и собирает награду за «новых».
 */
/**
 * Правила кассы этого заведения. `GET /v1/pos/config`.
 *
 * Экран кассы обязан знать их ДО того, как кассир нажмёт «посчитать».
 * Иначе выходит так: поле номера чека подписано «необязательно», кассир его
 * пропускает, сервер отвечает `RECEIPT_REQUIRED` — и всё это при госте,
 * который стоит у стойки. Отказывать за то, что мы и так знали, нельзя.
 *
 * Поля повторяют `ProgramConfig.cashierRules` (docs/01, раздел 4.3), но живут
 * отдельным контрактом: кассе незачем видеть ставки начисления, лестницу
 * статусов и мотивацию персонала — это данные бэк-офиса.
 */
export const PosConfig = z
  .object({
    /** Без номера чека операцию не с чем сверить при разборе. */
    requireReceiptNumber: z.boolean(),
    /** Потолок суммы ручного ввода в минорных единицах. null — без потолка. */
    maxManualAmount: z.number().int().positive().nullable(),
    /** Разрешён ли ручной ввод суммы вообще. */
    allowManualEntry: z.boolean(),
  })
  .strict()

export type PosConfig = z.infer<typeof PosConfig>

export const PosGuestQuery = z
  .object({
    token: z.string().min(8).max(512).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, 'Телефон в формате E.164, например +66812345678')
      .optional(),
  })
  .strict()
  .refine(
    (value) => (value.token === undefined) !== (value.phone === undefined),
    'Нужен ровно один параметр: token или phone',
  )

export type PosGuestQuery = z.infer<typeof PosGuestQuery>

export const PosGuest = z
  .object({
    guestId: z.uuid(),
    membershipId: z.uuid(),
    displayName: z.string().nullable(),
    /** Участие создаётся при коммите. От этого зависит будущая награда сотруднику. */
    isNew: z.boolean(),
    mode: GuestMode,
    /** Баллы в минорных единицах. */
    points: z.number().int(),
    visitsTotal: z.number().int().nonnegative(),
    /** Средний чек в минорных единицах. null, если визитов ещё не было. */
    avgCheck: z.number().int().nonnegative().nullable(),
    /**
     * Гость в контрольной группе: баллы ему не начисляются, и он это видит.
     * Кассир обязан знать заранее, иначе объяснять придётся постфактум.
     */
    isControlGroup: z.boolean(),
  })
  .strict()

export type PosGuest = z.infer<typeof PosGuest>

export const PreviewInput = z
  .object({
    membershipId: z.uuid(),
    /** Сумма чека в минорных единицах. Целое: сатанги, а не баты (CLAUDE.md, правило 4). */
    amount: z.number().int().positive(),
    /** Сколько баллов гость просит списать. */
    redeemRequested: z.number().int().nonnegative().default(0),
    receiptNumber: z.string().min(1).max(64).optional(),
    locationId: z.string().min(1).max(64).optional(),
  })
  .strict()

export type PreviewInput = z.infer<typeof PreviewInput>

export const PreviewResult = z
  .object({
    previewId: z.uuid(),
    expiresAt: z.iso.datetime(),
    amount: z.number().int().positive(),
    /** Потолок списания: доля чека из настроек, но не больше баланса. */
    maxRedeemable: z.number().int().nonnegative(),
    redeem: z.number().int().nonnegative(),
    amountToPay: z.number().int().nonnegative(),
    pointsToEarn: z.number().int().nonnegative(),
    /** Баланс на момент расчёта. Изменился к коммиту — BALANCE_CHANGED. */
    balanceAtPreview: z.number().int(),
  })
  .strict()

export type PreviewResult = z.infer<typeof PreviewResult>

export const CommitInput = z
  .object({
    previewId: z.uuid(),
    /** Идентификатор чека в кассе. Он же ключ идемпотентности операции. */
    receiptId: z.string().min(1).max(64),
    paidBy: PaidBy.optional(),
    /**
     * Что продали: id вида продажи из списка заведения.
     *
     * На коммите, а не на предрасчёте: вид не влияет на арифметику баллов,
     * а предрасчёт отвечает ровно на вопрос «сколько спишется и начислится».
     * Заводить ради него колонку в TransactionPreview значило бы хранить
     * лишнее состояние ради поля, которым он не пользуется.
     *
     * Необязателен: список видов ведут не все заведения.
     */
    saleKindId: z.uuid().optional(),
  })
  .strict()

export type CommitInput = z.infer<typeof CommitInput>

export const CommitResult = z
  .object({
    transactionId: z.uuid(),
    redeemed: z.number().int().nonnegative(),
    earned: z.number().int().nonnegative(),
    newBalance: z.number().int(),
    /** true, если этот же чек уже проводился: повтор вернул первый результат. */
    replayed: z.boolean(),
  })
  .strict()

export type CommitResult = z.infer<typeof CommitResult>

/**
 * Отмена проведённого чека. docs/02, раздел 3.5.
 *
 * Причина — тот же перечень, что у компенсаций журнала: второй список
 * «кассовых причин» разъехался бы с первым на первой же правке.
 */
/**
 * Погашение промокода на кассе. docs/02, раздел 3.4.
 *
 * Код гость показывает с экрана телефона, кассир вводит или сканирует.
 * Регистр и пробелы не важны: код читают глазами, а «KATA-200» и «kata 200»
 * для человека одно и то же.
 */
export const RedeemGrantInput = z
  .object({
    code: z.string().trim().min(4).max(32),
    /**
     * Чек, в котором гасят. КЛЮЧ ИДЕМПОТЕНТНОСТИ, а не справка.
     *
     * Повтор с тем же номером возвращает первый ответ вместо «код уже
     * погашен». Без него касса, потерявшая связь после успешного погашения,
     * решила бы, что операция не прошла, — и подарок гостю не отдала.
     *
     * Необязателен: гость может предъявить код и без чека, до заказа.
     * Тогда повтор идемпотентным не будет, и это честно — сопоставить его
     * не с чем.
     */
    receiptId: z.string().trim().min(1).max(64).optional(),
  })
  .strict()

export type RedeemGrantInput = z.infer<typeof RedeemGrantInput>

export const RedeemGrantResult = z
  .object({
    grantId: z.uuid(),
    code: z.string(),
    offerId: z.uuid(),
    /** Что именно отдать гостю. Пусто, если у акции нет названия. */
    title: z.string().nullable(),
    redeemedAt: z.iso.datetime(),
    /** Повтор того же чека: код уже был погашен этим же чеком. */
    replayed: z.boolean(),
  })
  .strict()

export type RedeemGrantResult = z.infer<typeof RedeemGrantResult>

export const PosVoidInput = z
  .object({
    reason: ReversalReason,
    /**
     * Комментарий. Для кассира в 15-минутном окне — по желанию; менеджеру и
     * владельцу обязателен всегда: их отмена не ограничена окном, и без
     * объяснения такая операция неотличима от заметания следов.
     */
    comment: z.string().trim().min(3).max(300).optional(),
  })
  .strict()

export type PosVoidInput = z.infer<typeof PosVoidInput>

export const PosVoidResult = z
  .object({
    transactionId: z.uuid(),
    /** Компенсированные записи чека: исходная → созданная компенсация. */
    reversals: z
      .array(
        z
          .object({
            entryId: z.uuid(),
            reversalId: z.uuid(),
            /** Знаковое изменение баллов компенсацией. */
            amount: z.number().int(),
          })
          .strict(),
      )
      .min(1),
    newBalance: z.number().int(),
    /** true — этот чек уже отменяли: повтор вернул прежний результат. */
    replayed: z.boolean(),
  })
  .strict()

export type PosVoidResult = z.infer<typeof PosVoidResult>
