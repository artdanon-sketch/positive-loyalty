import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  PartnerSaleKinds,
  PartnershipDetail,
  PartnershipMessageView,
  ProposeTermInput,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { PARTNERSHIPS_KEY } from '../partners/hooks'

/**
 * Одно партнёрство: карточка, действия, переписка, условия.
 *
 * Каждое действие сервер отвечает карточкой целиком — её и кладём в кэш,
 * без второго запроса. Список партнёрств при этом сбрасывается: статус
 * и число условий в нём тоже поменялись.
 */

const detailKey = (id: string): readonly string[] => ['admin', 'partnership', id]

export type PartnershipAction = 'accept' | 'decline' | 'end' | 'block'
export type TermAction = 'accept' | 'reject' | 'pause' | 'resume'

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
})

export function usePartnership(id: string): UseQueryResult<PartnershipDetail, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: detailKey(id),
    queryFn: () => authFetch<PartnershipDetail>(`/admin/partnerships/${encodeURIComponent(id)}`),
  })
}

export function usePartnerSaleKinds(id: string): UseQueryResult<PartnerSaleKinds, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: [...detailKey(id), 'sale-kinds'],
    queryFn: () =>
      authFetch<PartnerSaleKinds>(`/admin/partnerships/${encodeURIComponent(id)}/sale-kinds`),
  })
}

function useDetailMutation<TVariables>(
  id: string,
  request: (variables: TVariables) => { path: string; body: unknown },
): UseMutationResult<PartnershipDetail, Error, TVariables> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (variables) => {
      const { path, body } = request(variables)
      return authFetch<PartnershipDetail>(
        `/admin/partnerships/${encodeURIComponent(id)}${path}`,
        post(body),
      )
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(detailKey(id), detail)
      void queryClient.invalidateQueries({ queryKey: PARTNERSHIPS_KEY })
    },
  })
}

export function usePartnershipAction(
  id: string,
): UseMutationResult<
  PartnershipDetail,
  Error,
  { action: PartnershipAction; reason?: string; spam?: boolean }
> {
  return useDetailMutation(id, ({ action, reason, spam }) => ({
    path: `/${action}`,
    body: {
      ...(reason === undefined ? {} : { reason }),
      // Жалоба уходит только вместе с блокировкой: отдельно сервер её не примет.
      ...(action === 'block' && spam === true ? { spam } : {}),
    },
  }))
}

export function useProposeTerm(
  id: string,
): UseMutationResult<PartnershipDetail, Error, ProposeTermInput> {
  return useDetailMutation(id, (input) => ({ path: '/terms', body: input }))
}

export function useTermAction(
  id: string,
): UseMutationResult<PartnershipDetail, Error, { termId: string; action: TermAction }> {
  return useDetailMutation(id, ({ termId, action }) => ({
    path: `/terms/${encodeURIComponent(termId)}/${action}`,
    body: {},
  }))
}

export function useSendMessage(
  id: string,
): UseMutationResult<PartnershipMessageView, Error, string> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (text) =>
      authFetch<PartnershipMessageView>(
        `/admin/partnerships/${encodeURIComponent(id)}/messages`,
        post({ text }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey(id) })
    },
  })
}
