import { REVIEW_REPLY_MAX } from '@positive/contracts'
import type { ReviewSettings } from '@positive/contracts'

/**
 * Черновик автоответов на отзывы. docs/02, раздел 5.6.4 · docs/11, У10.
 *
 * Пять полей — на оценки от «1» до «5». Пустое поле — на эту оценку автоответа нет:
 * владелец ответит сам. Под формой одна строка «что поправить» — первая по порядку.
 */

export type RepliesCheck =
  | { readonly ok: true; readonly settings: ReviewSettings }
  | { readonly ok: false; readonly rating: number }

export const toRepliesDraft = (settings: ReviewSettings): string[] =>
  settings.autoReplies.map((reply) => reply ?? '')

export const fromRepliesDraft = (draft: readonly string[]): RepliesCheck => {
  const autoReplies = draft.map((value) => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  })

  const tooLong = autoReplies.findIndex(
    (reply) => reply !== null && reply.length > REVIEW_REPLY_MAX,
  )

  return tooLong === -1
    ? { ok: true, settings: { autoReplies } }
    : { ok: false, rating: tooLong + 1 }
}
