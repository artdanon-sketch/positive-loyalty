import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  AdminGuestCard,
  AdminGuestsList,
  IssueGiftInput,
  IssueGiftResult,
} from '@positive/contracts'

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

/**
 * Подарить гостю. Ключ повтора приходит от формы: один ключ на одно намерение.
 * После подарка карточка перечитывается — подарок сразу виден в истории.
 */
export function useIssueGift(
  guestId: string,
): UseMutationResult<IssueGiftResult, Error, { key: string; input: IssueGiftInput }> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, input }) =>
      authFetch<IssueGiftResult>(`/admin/guests/${encodeURIComponent(guestId)}/gifts`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card', guestId] })
    },
  })
}
