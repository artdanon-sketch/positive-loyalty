import { REVIEW_TAGS, ReviewTag } from '@positive/contracts'
import type { ReviewsSummary } from '@positive/contracts'

/**
 * Сводка отзывов за период. docs/02, раздел 5.12 · docs/11, У10.
 *
 * Чистая функция без базы: распределение, средняя и темы проверяются юнит-тестом
 * за миллисекунды, а интеграционный тест проверяет то, что живёт в базе, — выборку.
 */

export interface ReviewFacts {
  readonly rating: number
  readonly tags: readonly string[]
  readonly reply: string | null
}

export const isReviewTag = (value: string): value is ReviewTag => ReviewTag.safeParse(value).success

export const summarizeReviews = (rows: readonly ReviewFacts[]): ReviewsSummary => {
  const distribution = [0, 0, 0, 0, 0]
  const tagCounts = new Map<ReviewTag, number>()
  let sum = 0
  let unanswered = 0

  for (const row of rows) {
    distribution[row.rating - 1] = (distribution[row.rating - 1] ?? 0) + 1
    sum += row.rating

    // Автоответ — тоже ответ: гость его уже получил.
    if (row.reply === null) {
      unanswered += 1
    }

    // Тема считается один раз на отзыв, неизвестная — не считается вовсе.
    for (const tag of new Set(row.tags)) {
      if (isReviewTag(tag)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
  }

  return {
    total: rows.length,
    average: rows.length === 0 ? null : Math.round((sum / rows.length) * 10) / 10,
    distribution,
    // Сортировка устойчивая: при равенстве темы идут в порядке справочника.
    tags: REVIEW_TAGS.map((tag) => ({ tag, count: tagCounts.get(tag) ?? 0 })).sort(
      (a, b) => b.count - a.count,
    ),
    unanswered,
  }
}
