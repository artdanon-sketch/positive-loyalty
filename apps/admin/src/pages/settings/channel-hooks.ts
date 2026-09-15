import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { Channel, CreateChannelInput, UpdateChannelInput } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Источники трафика — справочник заведения. docs/02, раздел 5.9.
 * После правки перечитывается и отчёт: выключенный источник там помечен.
 */

export const CHANNELS_KEY = ['admin', 'channels'] as const

export function useChannels(): UseQueryResult<Channel[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: () => authFetch<Channel[]>('/admin/channels'),
  })
}

export function useCreateChannel(): UseMutationResult<Channel, Error, CreateChannelInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<Channel>('/admin/channels', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports', 'channels'] })
    },
  })
}

export function useUpdateChannel(): UseMutationResult<
  Channel,
  Error,
  { id: string; input: UpdateChannelInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }) =>
      authFetch<Channel>(`/admin/channels/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports', 'channels'] })
    },
  })
}
