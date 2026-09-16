import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { AdminGuestMessage, AdminMessagesList } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { messagesPath } from './messages-filters'
import type { MessageFilters } from './messages-filters'

/**
 * Жалобы и предложения. docs/02, раздел 5.15.
 *
 * Прошлый список остаётся на экране, пока грузится новый: переключая фильтр,
 * владелец не должен смотреть на мигающую пустоту — как в отзывах.
 */

const MESSAGES_KEY = ['admin', 'messages'] as const

export function useMessages(
  filters: MessageFilters,
  offset: number,
): UseQueryResult<AdminMessagesList, Error> {
  const { authFetch } = useAuth()
  const path = messagesPath(filters, offset)

  return useQuery({
    queryKey: [...MESSAGES_KEY, path],
    queryFn: () => authFetch<AdminMessagesList>(path),
    placeholderData: keepPreviousData,
  })
}

/** Ответ гостю. «Ждут ответа» пересчитывается — список перечитывается целиком. */
export function useReplyMessage(): UseMutationResult<
  AdminGuestMessage,
  Error,
  { id: string; text: string }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, text }) =>
      authFetch<AdminGuestMessage>(`/admin/messages/${encodeURIComponent(id)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
    },
  })
}
