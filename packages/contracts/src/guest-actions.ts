import { z } from 'zod'

/**
 * Действия в карточке гостя: баллы вручную и заметка.
 * docs/02, разделы 5.2.3–5.2.4 · docs/11, У5.
 */

/** Потолок ручной правки: 100 000 ฿ одним движением — опечатка, а не щедрость. */
export const POINTS_ADJUST_MAX = 10_000_000

/** Заметка — это «аллергия на арахис, любит столик у окна», а не досье. */
export const GUEST_NOTE_MAX = 1000

/**
 * Баллы вручную. Сумма со знаком: плюс — начислить, минус — списать.
 *
 * НОЛЬ ЗАПРЕЩЁН: правка на ноль ничего не меняет, а в журнале и аудите оставила
 * бы строку, которую потом пришлось бы объяснять.
 */
export const AdjustPointsInput = z
  .object({
    amount: z
      .number()
      .int()
      .min(-POINTS_ADJUST_MAX)
      .max(POINTS_ADJUST_MAX)
      .refine((value) => value !== 0, 'Правка на ноль ничего не меняет'),
    reason: z.string().trim().min(8).max(300),
  })
  .strict()

export type AdjustPointsInput = z.infer<typeof AdjustPointsInput>

export const AdjustPointsResult = z
  .object({
    entryId: z.uuid(),
    /** Со знаком, как в журнале. */
    amount: z.number().int(),
    /** Баланс после правки. */
    balance: z.number().int(),
    /** Повтор с тем же ключом: это первая правка, второй не было. */
    replayed: z.boolean(),
  })
  .strict()

export type AdjustPointsResult = z.infer<typeof AdjustPointsResult>

/** Заметка о госте. Пустой текст — стереть заметку. */
export const GuestNoteInput = z
  .object({
    text: z.string().trim().max(GUEST_NOTE_MAX),
  })
  .strict()

export type GuestNoteInput = z.infer<typeof GuestNoteInput>

export const GuestNoteResult = z
  .object({
    note: z.string().nullable(),
  })
  .strict()

export type GuestNoteResult = z.infer<typeof GuestNoteResult>
