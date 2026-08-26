import { z } from 'zod'

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
