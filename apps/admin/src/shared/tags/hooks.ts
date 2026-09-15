import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { CreateTagInput, Tag } from '@positive/contracts'

import { useAuth } from '../auth/auth-context'

/**
 * Справочник тегов заведения. docs/02, раздел 5.2.5.
 *
 * Общий для карточки гостя и настроек: тег, заведённый у стойки, сразу виден
 * в настройках, и наоборот — ключ кэша один.
 */

export const TAGS_KEY = ['admin', 'tags'] as const

export function useTags(): UseQueryResult<Tag[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: TAGS_KEY,
    queryFn: () => authFetch<Tag[]>('/admin/tags'),
  })
}

export function useCreateTag(): UseMutationResult<Tag, Error, CreateTagInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<Tag>('/admin/tags', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TAGS_KEY })
    },
  })
}

/**
 * Удалить тег — он сходит со всех гостей. Ответ пустой (204), поэтому через
 * authStream: он не пытается разобрать тело как JSON.
 */
export function useDeleteTag(): UseMutationResult<void, Error, string> {
  const { authStream } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id) => {
      await authStream(`/admin/tags/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TAGS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guests'] })
    },
  })
}
