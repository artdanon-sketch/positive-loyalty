import type { DashboardPeriod } from '@positive/contracts'

/**
 * Фильтры отзывов живут в адресе (`?rating=2&answered=no`): ссылку «двойки без ответа»
 * владелец пересылает управляющему, а перезагрузка не теряет выбранного.
 * docs/03, раздел «Отзывы» · docs/11, У10.
 */

export const REVIEWS_PAGE = 20

export type ReviewAnswered = 'yes' | 'no'

export interface ReviewFilters {
  /** Оценка от 1 до 5; null — любая. */
  readonly rating: number | null
  /** С ответом, ждут ответа; null — все. */
  readonly answered: ReviewAnswered | null
}

export const filtersFromParams = (params: URLSearchParams): ReviewFilters => {
  const rating = Number(params.get('rating'))
  const answered = params.get('answered')

  return {
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    answered: answered === 'yes' || answered === 'no' ? answered : null,
  }
}

export const writeFilters = (params: URLSearchParams, filters: ReviewFilters): void => {
  if (filters.rating === null) {
    params.delete('rating')
  } else {
    params.set('rating', String(filters.rating))
  }

  if (filters.answered === null) {
    params.delete('answered')
  } else {
    params.set('answered', filters.answered)
  }
}

export const reviewsPath = (
  period: DashboardPeriod,
  filters: ReviewFilters,
  offset: number,
): string => {
  const query = new URLSearchParams({
    period,
    limit: String(REVIEWS_PAGE),
    offset: String(offset),
  })

  writeFilters(query, filters)

  return `/admin/reviews?${query.toString()}`
}
