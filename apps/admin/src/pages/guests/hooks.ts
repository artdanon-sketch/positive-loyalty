import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AdminGuestsList } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

export const GUESTS_PAGE_SIZE = 20

export function useGuestsPage(offset: number): UseQueryResult<AdminGuestsList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'guests', offset],
    queryFn: () =>
      authFetch<AdminGuestsList>(`/admin/guests?limit=${GUESTS_PAGE_SIZE}&offset=${offset}`),
    placeholderData: keepPreviousData,
  })
}
