import { z } from 'zod'

/**
 * Подарок гостю из карточки. docs/10, раздел 5.2 · docs/02, раздел 5.2.1.
 *
 * Спор у стойки — «долго ждал», «перепутали заказ» — решается на месте
 * подарком, а не извинением. Подарок — промокод: он сразу появляется у гостя
 * в приложении и гасится на кассе, как любой другой.
 *
 * ПРИЧИНА ОБЯЗАТЕЛЬНА. Подарок стоит заведению денег, и через месяц владелец
 * должен видеть не «менеджер раздал сорок десертов», а за что каждый.
 */

export const GiftReason = z.enum(['LONG_WAIT', 'STAFF_ERROR', 'COMPLAINT', 'CELEBRATION', 'OTHER'])
export type GiftReason = z.infer<typeof GiftReason>

export const GIFT_TITLE_MAX = 80
export const GIFT_VALIDITY_MAX_DAYS = 90

export const IssueGiftInput = z
  .object({
    /** Что дарим — так и увидит гость: «Десерт», «Кофе», «Скидка 10%». */
    title: z
      .string()
      .trim()
      .min(2, 'Напишите, что дарите: «десерт», «кофе», «скидка 10%»')
      .max(GIFT_TITLE_MAX)
      .optional(),
    /**
     * Шаблон сертификата (docs/11, У9): название и срок берутся из него, поэтому
     * с шаблоном название не нужно.
     */
    certificateId: z.uuid().optional(),
    reason: GiftReason,
    comment: z.string().trim().min(1).max(300).optional(),
    /** Сколько дней действует промокод. */
    validityDays: z.number().int().min(1).max(GIFT_VALIDITY_MAX_DAYS).default(14),
  })
  .strict()
  .refine((input) => input.reason !== 'OTHER' || input.comment !== undefined, {
    error:
      'Для «другой причины» напишите пару слов — через месяц никто не вспомнит, за что подарили',
    path: ['comment'],
  })
  .refine((input) => input.certificateId !== undefined || input.title !== undefined, {
    error: 'Напишите, что дарите: «десерт», «кофе», «скидка 10%» — или выберите сертификат',
    path: ['title'],
  })

export type IssueGiftInput = z.infer<typeof IssueGiftInput>

/**
 * Ответ на подарок.
 *
 * Кода целиком здесь нет: он у гостя в приложении, а сотруднику полный код
 * нужен только затем, чтобы погасить подарок самому. Хвоста из четырёх знаков
 * хватает, чтобы сверить с экраном гостя.
 */
export const IssueGiftResult = z
  .object({
    grantId: z.uuid(),
    title: z.string(),
    codeTail: z.string().min(1).max(4),
    expiresAt: z.iso.datetime(),
    /** Повтор с тем же ключом: подарок не новый, а тот же самый. */
    replayed: z.boolean(),
  })
  .strict()

export type IssueGiftResult = z.infer<typeof IssueGiftResult>

/**
 * Заголовок Idempotency-Key (CLAUDE.md, железное правило 3).
 *
 * Браузер создаёт один ключ на одно намерение подарить. Повтор после обрыва
 * связи идёт с тем же ключом и возвращает тот же подарок — второй десерт
 * за одну жалобу заведение не отдаст.
 */
export const IdempotencyKeyHeader = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
