import { z } from 'zod'

/**
 * «Сегодня» на главной бэк-офиса. docs/02, раздел 5.1.2 · docs/11, У11.
 *
 * Цифры дня по часам заведения — по тем же правилам, что отчёт «Операции»: отменённый
 * чек не считается, выручка — заплаченное деньгами. И чеклист «настройте за 5 минут»:
 * сделанный шаг карточкой не показывается.
 */

const Count = z.number().int().nonnegative()
const Minor = z.number().int().nonnegative()

/** Шаги настройки — в порядке, в котором их стоит пройти. */
export const SetupStep = z.enum(['PROGRAM', 'CASHIER', 'OFFER', 'CHANNEL'])
export type SetupStep = z.infer<typeof SetupStep>

export const SETUP_STEPS: readonly SetupStep[] = SetupStep.options

export const SetupItem = z.object({ step: SetupStep, done: z.boolean() }).strict()
export type SetupItem = z.infer<typeof SetupItem>

export const AdminToday = z
  .object({
    /** Сегодняшняя дата по часам заведения, `YYYY-MM-DD`. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Выручка — заплаченное деньгами по неотменённым чекам, сатанги. */
    revenue: Minor,
    purchases: Count,
    /** Средний чек, сатанги. null — чеков сегодня нет. */
    avgCheck: Minor.nullable(),
    /** Разных гостей с чеком сегодня. */
    buyers: Count,
    /** Стали гостями заведения сегодня. */
    newGuests: Count,
    /** Гостей в программе всего. */
    totalGuests: Count,
    pointsEarned: Count,
    pointsRedeemed: Count,
    /** Отменённых сегодняшних чеков. */
    voided: Count,
    /** Все шаги по порядку — сделанные тоже: экран решает, что показать. */
    setup: z.array(SetupItem).length(SETUP_STEPS.length),
  })
  .strict()

export type AdminToday = z.infer<typeof AdminToday>
