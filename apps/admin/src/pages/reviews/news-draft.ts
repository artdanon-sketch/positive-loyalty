import { NEWS_BODY_MAX, NEWS_TITLE_MAX } from '@positive/contracts'
import type { CreateNewsInput } from '@positive/contracts'

/**
 * Черновик новой новости. docs/02, раздел 5.14 · docs/11, У13.
 *
 * Те же границы, что на сервере: заголовок от 2 до 120 знаков, текст от 1 до 2000.
 * Под формой одна строка «что поправить» — первая по порядку полей.
 */

export interface NewsDraft {
  readonly title: string
  readonly body: string
  readonly publish: boolean
}

export type NewsProblem = 'title' | 'body'

export type NewsCheck =
  | { readonly ok: true; readonly input: CreateNewsInput }
  | { readonly ok: false; readonly problem: NewsProblem }

export const BLANK_NEWS: NewsDraft = { title: '', body: '', publish: false }

export const fromNewsDraft = (draft: NewsDraft): NewsCheck => {
  const title = draft.title.trim()

  if (title.length < 2 || title.length > NEWS_TITLE_MAX) {
    return { ok: false, problem: 'title' }
  }

  const body = draft.body.trim()

  if (body.length === 0 || body.length > NEWS_BODY_MAX) {
    return { ok: false, problem: 'body' }
  }

  return { ok: true, input: { title, body, publish: draft.publish } }
}
