import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { AdminNews, CreateNewsInput, UpdateNewsInput } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Новости заведения. docs/02, раздел 5.14. */

const NEWS_KEY = ['admin', 'news'] as const

export function useNews(): UseQueryResult<AdminNews[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: NEWS_KEY,
    queryFn: () => authFetch<AdminNews[]>('/admin/news'),
  })
}

export function useCreateNews(): UseMutationResult<AdminNews, Error, CreateNewsInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<AdminNews>('/admin/news', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NEWS_KEY })
    },
  })
}

export function useUpdateNews(): UseMutationResult<
  AdminNews,
  Error,
  { id: string; input: UpdateNewsInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }) =>
      authFetch<AdminNews>(`/admin/news/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NEWS_KEY })
    },
  })
}
