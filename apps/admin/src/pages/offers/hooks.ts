import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { AdminOfferList, OfferChangeResult, OfferListFilter } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { useLocale } from '../../shared/i18n'

/** Акции заведения. Названия и условия — на языке того, кто смотрит. */
export function useOffers(filter: OfferListFilter): UseQueryResult<AdminOfferList, Error> {
  const { authFetch } = useAuth()
  const locale = useLocale()

  return useQuery({
    queryKey: ['admin', 'offers', filter, locale],
    queryFn: () => authFetch<AdminOfferList>(`/admin/offers?filter=${filter}&locale=${locale}`),
    placeholderData: keepPreviousData,
  })
}

export type OfferAction = 'publish' | 'pause' | 'end'

/**
 * Запустить, поставить на паузу, завершить. После шага список перечитывается
 * целиком: статус по датам и кнопки считает сервер, и угадывать их здесь —
 * значит однажды показать кнопку, которая ответит отказом.
 */
export function useOfferTransition(): UseMutationResult<
  OfferChangeResult,
  Error,
  { id: string; action: OfferAction }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, action }) =>
      authFetch<OfferChangeResult>(`/admin/offers/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] })
    },
  })
}
