import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { IntegrationSecret, IntegrationStatus, RotateSecretInput } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Интеграция с кассой. docs/02, раздел 5.16. */

const INTEGRATION_KEY = ['admin', 'integration'] as const

export function useIntegration(): UseQueryResult<IntegrationStatus, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: INTEGRATION_KEY,
    queryFn: () => authFetch<IntegrationStatus>('/admin/integration'),
  })
}

export function useRevealSecret(): UseMutationResult<IntegrationSecret, Error, void> {
  const { authFetch } = useAuth()

  return useMutation({
    mutationFn: () =>
      authFetch<IntegrationSecret>('/admin/integration/secret/reveal', { method: 'POST' }),
  })
}

export function useRotateSecret(): UseMutationResult<IntegrationSecret, Error, RotateSecretInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<IntegrationSecret>('/admin/integration/secret/rotate', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTEGRATION_KEY })
    },
  })
}
