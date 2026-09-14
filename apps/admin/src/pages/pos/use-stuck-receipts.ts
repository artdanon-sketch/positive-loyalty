import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { StuckReceiptList } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Чеки, которые не дошли с планшетов. Перечитываются раз в минуту: владелец
 * держит экран кассы открытым, и чек, дошедший за это время, должен пропасть
 * из списка сам.
 */
export function useStuckReceipts(enabled: boolean): UseQueryResult<StuckReceiptList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'stuck-receipts'],
    queryFn: () => authFetch<StuckReceiptList>('/admin/stuck-receipts'),
    enabled,
    refetchInterval: 60_000,
  })
}
