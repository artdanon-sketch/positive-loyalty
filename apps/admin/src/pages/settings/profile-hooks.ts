import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { TenantProfile } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Профиль заведения. docs/02, раздел 5.6.7. */

const PROFILE_KEY = ['admin', 'settings', 'profile'] as const

export function useTenantProfile(): UseQueryResult<TenantProfile, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => authFetch<TenantProfile>('/admin/settings/profile'),
  })
}

export function useSaveTenantProfile(): UseMutationResult<TenantProfile, Error, TenantProfile> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<TenantProfile>('/admin/settings/profile', {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
    },
  })
}
