import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { ProgramSettings } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Настройки программы.
 *
 * После сохранения сбрасывается и кэш правил кассы: планшет, открытый в том же
 * браузере, иначе продолжал бы требовать номер чека, который владелец только что
 * сделал необязательным, — до перезагрузки страницы.
 */

const KEY = ['admin', 'settings', 'program'] as const

export function useProgramSettings(): UseQueryResult<ProgramSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: KEY,
    queryFn: () => authFetch<ProgramSettings>('/admin/settings/program'),
  })
}

export function useSaveProgramSettings(): UseMutationResult<
  ProgramSettings,
  Error,
  ProgramSettings
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<ProgramSettings>('/admin/settings/program', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(KEY, saved)
      void queryClient.invalidateQueries({ queryKey: ['pos', 'config'] })
    },
  })
}
