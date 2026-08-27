import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AdminDashboard, DashboardPeriod } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Сводка экрана «Обзор». `GET /v1/admin/dashboard` (docs/03, раздел 2).
 *
 * `keepPreviousData`: при переключении периода старые цифры остаются на месте,
 * пока едут новые. Иначе экран схлопывается в скелетоны на каждый клик, и
 * владелец теряет то, с чем сравнивал.
 */
export const PERIODS: readonly DashboardPeriod[] = ['7d', '30d', '90d']

export function useDashboard(period: DashboardPeriod): UseQueryResult<AdminDashboard, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'dashboard', period],
    queryFn: () => authFetch<AdminDashboard>(`/admin/dashboard?period=${period}`),
    placeholderData: keepPreviousData,
  })
}
