import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import type {
  AdjustPointsInput,
  AdjustPointsResult,
  GuestNoteResult,
  GuestTagsResult,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Действия в карточке гостя: баллы вручную, заметка, теги. docs/02, разделы 5.2.3–5.2.5.
 * После каждого карточка перечитывается — изменение видно сразу.
 */

/** Баллы вручную. Ключ повтора приходит от формы: один ключ на одно намерение. */
export function useAdjustPoints(
  guestId: string,
): UseMutationResult<AdjustPointsResult, Error, { key: string; input: AdjustPointsInput }> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, input }) =>
      authFetch<AdjustPointsResult>(`/admin/guests/${encodeURIComponent(guestId)}/points`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card', guestId] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guests'] })
    },
  })
}

export function useSaveNote(guestId: string): UseMutationResult<GuestNoteResult, Error, string> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (text) =>
      authFetch<GuestNoteResult>(`/admin/guests/${encodeURIComponent(guestId)}/note`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card', guestId] })
    },
  })
}

/** Теги гостя — набором целиком. */
export function useSetGuestTags(
  guestId: string,
): UseMutationResult<GuestTagsResult, Error, readonly string[]> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (tagIds) =>
      authFetch<GuestTagsResult>(`/admin/guests/${encodeURIComponent(guestId)}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tagIds }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card', guestId] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guests'] })
    },
  })
}
