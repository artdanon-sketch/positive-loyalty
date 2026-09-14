import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  CreateInviteInput,
  CreateInviteResult,
  InviteQuotaView,
  PartnerCatalog,
  PartnershipList,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Раздел «Партнёры»: список, каталог сети, квота и приглашение.
 *
 * Квота лежит под ключом списка намеренно: любое действие с партнёрствами
 * сбрасывает список — и вместе с ним остаток бесплатных приглашений.
 */

export const PARTNERSHIPS_KEY = ['admin', 'partnerships'] as const
const CATALOG_KEY = ['admin', 'partners', 'catalog'] as const

export function usePartnerships(): UseQueryResult<PartnershipList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: PARTNERSHIPS_KEY,
    queryFn: () => authFetch<PartnershipList>('/admin/partnerships'),
  })
}

export function useCatalog(): UseQueryResult<PartnerCatalog, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: () => authFetch<PartnerCatalog>('/admin/partners/catalog'),
  })
}

export function useInviteQuota(): UseQueryResult<InviteQuotaView, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: [...PARTNERSHIPS_KEY, 'quota'],
    queryFn: () => authFetch<InviteQuotaView>('/admin/partnerships/quota'),
  })
}

export function useInvite(): UseMutationResult<CreateInviteResult, Error, CreateInviteInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<CreateInviteResult>('/admin/partnerships/invites', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERSHIPS_KEY })
      void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}
