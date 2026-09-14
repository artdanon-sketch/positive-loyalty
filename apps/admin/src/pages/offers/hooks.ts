import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AdminOfferList, OfferListFilter } from '@positive/contracts'

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
