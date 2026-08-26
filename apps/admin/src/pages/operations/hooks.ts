import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AdminLedgerList } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

export const OPERATIONS_PAGE_SIZE = 20

/**
 * Страница журнала. `placeholderData: keepPreviousData` — чтобы при листании
 * таблица не схлопывалась в скелет: старая страница видна, пока едет новая.
 */
export function useLedgerPage(offset: number): UseQueryResult<AdminLedgerList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'ledger', offset],
    queryFn: () =>
      authFetch<AdminLedgerList>(`/admin/ledger?limit=${OPERATIONS_PAGE_SIZE}&offset=${offset}`),
    placeholderData: keepPreviousData,
  })
}
