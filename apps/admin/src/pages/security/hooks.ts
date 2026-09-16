import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { DashboardPeriod, SecurityHistory, SuspiciousReport } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

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

/** Страница истории: `before` — момент, раньше которого события; null — самые свежие. */
export function useSecurityHistory(before: string | null): UseQueryResult<SecurityHistory, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'security', 'history', before ?? 'latest'],
    queryFn: () =>
      authFetch<SecurityHistory>(
        before === null
          ? '/admin/security/history'
          : `/admin/security/history?before=${encodeURIComponent(before)}`,
      ),
    placeholderData: keepPreviousData,
  })
}
