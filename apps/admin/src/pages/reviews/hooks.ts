import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { AdminReview, AdminReviewsList, DashboardPeriod } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { reviewsPath } from './filters'
import type { ReviewFilters } from './filters'

/**
 * Отзывы гостей. docs/02, раздел 5.12.
 *
 * Прошлый список остаётся на экране, пока грузится новый: переключая фильтр,
 * владелец не должен смотреть на мигающую пустоту.
 */

const REVIEWS_KEY = ['admin', 'reviews'] as const

export function useReviews(
  period: DashboardPeriod,
  filters: ReviewFilters,
  offset: number,
): UseQueryResult<AdminReviewsList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: [...REVIEWS_KEY, period, filters.rating, filters.answered, offset],
    queryFn: () => authFetch<AdminReviewsList>(reviewsPath(period, filters, offset)),
    placeholderData: keepPreviousData,
  })
}

/** Ответ гостю. Сводка «ждут ответа» пересчитывается — список перечитывается целиком. */
export function useReplyReview(): UseMutationResult<
  AdminReview,
  Error,
  { id: string; text: string }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, text }) =>
      authFetch<AdminReview>(`/admin/reviews/${encodeURIComponent(id)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEWS_KEY })
    },
  })
}
