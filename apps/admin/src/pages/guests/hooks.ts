import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AdminGuestCard, AdminGuestsList } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { useLocale } from '../../shared/i18n'

export const GUESTS_PAGE_SIZE = 20

export function useGuestsPage(
  offset: number,
  search: string,
): UseQueryResult<AdminGuestsList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'guests', search, offset],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(GUESTS_PAGE_SIZE),
        offset: String(offset),
      })

      if (search !== '') {
        params.set('q', search)
      }

      return authFetch<AdminGuestsList>(`/admin/guests?${params.toString()}`)
    },
    placeholderData: keepPreviousData,
  })
}

/** Карточка гостя. Названия подарков — на языке интерфейса того, кто смотрит. */
export function useGuestCard(guestId: string): UseQueryResult<AdminGuestCard, Error> {
  const { authFetch } = useAuth()
  const locale = useLocale()

  return useQuery({
    queryKey: ['admin', 'guest-card', guestId, locale],
    queryFn: () =>
      authFetch<AdminGuestCard>(`/admin/guests/${encodeURIComponent(guestId)}?locale=${locale}`),
  })
}
