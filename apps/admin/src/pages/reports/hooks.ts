import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  ChannelReport,
  CustomersReport,
  DashboardPeriod,
  OperationsReport,
  RfmReport,
  StaffReport,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Отчёты заведения. docs/02, разделы 5.9 и 5.10.
 *
 * Прошлые цифры остаются на экране, пока грузятся новые: таблица, мигающая
 * пустотой при каждом переключении периода, читается хуже, чем чуть устаревшая.
 * Каждый отчёт запрашивается только на своей вкладке.
 */

const useReport = <T>(
  key: string,
  path: string,
  period?: DashboardPeriod,
): UseQueryResult<T, Error> => {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'reports', key, period ?? 'now'],
    queryFn: () => authFetch<T>(period === undefined ? path : `${path}?period=${period}`),
    placeholderData: keepPreviousData,
  })
}

export const useChannelReport = (period: DashboardPeriod): UseQueryResult<ChannelReport, Error> =>
  useReport<ChannelReport>('channels', '/admin/reports/channels', period)

export const useCustomersReport = (
  period: DashboardPeriod,
): UseQueryResult<CustomersReport, Error> =>
  useReport<CustomersReport>('customers', '/admin/reports/customers', period)

export const useOperationsReport = (
  period: DashboardPeriod,
): UseQueryResult<OperationsReport, Error> =>
  useReport<OperationsReport>('operations', '/admin/reports/operations', period)

/** RFM — срез «на сегодня», без периода. */
export const useRfmReport = (): UseQueryResult<RfmReport, Error> =>
  useReport<RfmReport>('rfm', '/admin/reports/rfm')

export const useStaffReport = (period: DashboardPeriod): UseQueryResult<StaffReport, Error> =>
  useReport<StaffReport>('staff', '/admin/reports/staff', period)
