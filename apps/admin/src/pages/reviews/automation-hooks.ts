import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  AutomationKind,
  AutomationRule,
  AutomationRules,
  SaveAutomationInput,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Автосценарии рассылок. docs/02, раздел 5.4.1. */

const AUTOMATION_KEY = ['admin', 'automation'] as const

export function useAutomation(): UseQueryResult<AutomationRules, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: AUTOMATION_KEY,
    queryFn: () => authFetch<AutomationRules>('/admin/automation'),
  })
}

export function useSaveAutomation(): UseMutationResult<
  AutomationRule,
  Error,
  { kind: AutomationKind; input: SaveAutomationInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ kind, input }) =>
      authFetch<AutomationRule>(`/admin/automation/${kind}`, {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AUTOMATION_KEY })
    },
  })
}
