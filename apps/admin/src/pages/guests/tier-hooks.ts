import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import type { GuestTierResult, SetGuestTierInput } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Ручной статус гостя. docs/02, раздел 5.2.2.
 * После правки карточка перечитывается — чип статуса меняется сразу.
 */
export function useSetGuestTier(
  guestId: string,
): UseMutationResult<GuestTierResult, Error, SetGuestTierInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<GuestTierResult>(`/admin/guests/${encodeURIComponent(guestId)}/tier`, {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card', guestId] })
    },
  })
}
