import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  AdminBroadcast,
  AdminBroadcastsList,
  BroadcastAudience,
  BroadcastPreview,
  CreateBroadcastInput,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Рассылки и автосценарии. docs/02, разделы 5.4 и 5.4.1. */

const BROADCASTS_KEY = ['admin', 'broadcasts'] as const

export function useBroadcasts(): UseQueryResult<AdminBroadcastsList, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: BROADCASTS_KEY,
    queryFn: () => authFetch<AdminBroadcastsList>('/admin/broadcasts'),
    // Отправка идёт порциями в фоне: цифры «доставлено» растут на глазах.
    refetchInterval: 15_000,
  })
}

export function useBroadcastPreview(
  audience: BroadcastAudience,
): UseQueryResult<BroadcastPreview, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'broadcasts', 'preview', audience],
    queryFn: () =>
      authFetch<BroadcastPreview>('/admin/broadcasts/preview', {
        method: 'POST',
        body: JSON.stringify({ audience }),
        headers: { 'Content-Type': 'application/json' },
      }),
  })
}

export function useCreateBroadcast(): UseMutationResult<
  AdminBroadcast,
  Error,
  CreateBroadcastInput
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<AdminBroadcast>('/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BROADCASTS_KEY })
    },
  })
}
