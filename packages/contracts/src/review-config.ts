import { z } from 'zod'

/**
 * Автоответы на отзывы. docs/02, раздел 5.6.4 · docs/11, У10.
 *
 * Отдельным модулем от `review.ts`: настройки лежат в `Tenant.settings` и разбираются
 * `ProgramConfig`, а списку отзывов нужен период из `admin.ts` — одним файлом они
 * замкнули бы импорты по кругу.
 */

export const REVIEW_REPLY_MAX = 1000

/** Ответ гостю — владельца или автоответ. */
export const ReviewReplyText = z
  .string()
  .trim()
  .min(1, 'Напишите ответ')
  .max(REVIEW_REPLY_MAX, `Ответ — не длиннее ${String(REVIEW_REPLY_MAX)} знаков`)

/**
 * Автоответ по числу звёзд: пять мест, первое — на «1», пятое — на «5».
 * null — на эту оценку автоответа нет, отвечает владелец.
 */
export const ReviewAutoReplies = z.array(ReviewReplyText.nullable()).length(5)

export type ReviewAutoReplies = z.infer<typeof ReviewAutoReplies>

export const ReviewConfig = z
  .object({
    autoReplies: ReviewAutoReplies.default([null, null, null, null, null]),
  })
  .strict()

export type ReviewConfig = z.infer<typeof ReviewConfig>

/** Автоответы на экране владельца — то же, что в конфиге, но без умолчаний. */
export const ReviewSettings = z
  .object({
    autoReplies: ReviewAutoReplies,
  })
  .strict()

export type ReviewSettings = z.infer<typeof ReviewSettings>
