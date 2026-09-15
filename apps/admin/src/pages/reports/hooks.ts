import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ChannelReport, DashboardPeriod } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Отчёт «Источники». docs/02, раздел 5.9.
 *
 * Прошлые цифры остаются на экране, пока грузятся новые: таблица, мигающая
 * пустотой при каждом переключении периода, читается хуже, чем чуть устаревшая.
 */
export function useChannelReport(period: DashboardPeriod): UseQueryResult<ChannelReport, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'reports', 'channels', period],
    queryFn: () => authFetch<ChannelReport>(`/admin/reports/channels?period=${period}`),
    placeholderData: keepPreviousData,
  })
}
