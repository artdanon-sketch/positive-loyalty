import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { DashboardPeriod, SecurityHistory, SuspiciousReport } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { historyPath } from './history-filters'
import type { HistoryFilters } from './history-filters'

/**
 * Безопасность заведения. docs/02, раздел 5.13.
 *
 * Прошлые данные остаются на экране, пока грузятся новые: разбор не должен мигать
 * пустотой при каждом переключении периода или страницы.
 */

export function useSuspicious(period: DashboardPeriod): UseQueryResult<SuspiciousReport, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'security', 'suspicious', period],
    queryFn: () => authFetch<SuspiciousReport>(`/admin/security/suspicious?period=${period}`),
    placeholderData: keepPreviousData,
  })
}

/**
 * Страница истории: `before` — момент, раньше которого события; null — самые свежие.
 * Фильтры входят в ключ кеша: день и сотрудник меняют выборку так же, как страница.
 */
export function useSecurityHistory(
  filters: HistoryFilters,
  before: string | null,
): UseQueryResult<SecurityHistory, Error> {
  const { authFetch } = useAuth()
  const path = historyPath(filters, before)

  return useQuery({
    queryKey: ['admin', 'security', 'history', path],
    queryFn: () => authFetch<SecurityHistory>(path),
    placeholderData: keepPreviousData,
  })
}
