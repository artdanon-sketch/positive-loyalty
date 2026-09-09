import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { CreateSaleKindInput, SaleKind, UpdateSaleKindInput } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Справочник видов продаж заведения.
 *
 * Настройка, а не ежедневная работа: заводят раз и правят редко. Поэтому
 * данные держатся дольше обычного — перечитывать список на каждом заходе
 * незачем, а после своей же правки он обновляется принудительно.
 */

const KEY = ['admin', 'sale-kinds'] as const

/** Настройка меняется раз в месяц: держим пять минут, как и правила кассы. */
const STALE_MS = 5 * 60 * 1000

export function useSaleKinds(): UseQueryResult<SaleKind[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: KEY,
    queryFn: () => authFetch<SaleKind[]>('/admin/sale-kinds'),
    staleTime: STALE_MS,
  })
}

export function useCreateSaleKind(): UseMutationResult<SaleKind, Error, CreateSaleKindInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<SaleKind>('/admin/sale-kinds', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
      // Касса берёт список из своего адреса: без сброса кассир не увидел бы
      // только что заведённый вид до перезагрузки страницы.
      void queryClient.invalidateQueries({ queryKey: ['pos', 'sale-kinds'] })
    },
  })
}

export function useUpdateSaleKind(): UseMutationResult<
  SaleKind,
  Error,
  { id: string; patch: UpdateSaleKindInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, patch }) =>
      authFetch<SaleKind>(`/admin/sale-kinds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
      void queryClient.invalidateQueries({ queryKey: ['pos', 'sale-kinds'] })
    },
  })
}
