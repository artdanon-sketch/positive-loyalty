import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { ProgramSettings, TierSettings } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Настройки программы.
 *
 * После сохранения сбрасывается и кэш правил кассы: планшет, открытый в том же
 * браузере, иначе продолжал бы требовать номер чека, который владелец только что
 * сделал необязательным, — до перезагрузки страницы.
 */

const KEY = ['admin', 'settings', 'program'] as const
const TIERS_KEY = ['admin', 'settings', 'tiers'] as const

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

/** Статусы гостей и приветственные баллы — своим входом (docs/02, раздел 5.6.1). */
export function useTierSettings(): UseQueryResult<TierSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: TIERS_KEY,
    queryFn: () => authFetch<TierSettings>('/admin/settings/program/tiers'),
  })
}

/**
 * Сохранить лестницу. Карточки гостей перечитываются: статус в них считается
 * по лестнице и после сохранения мог стать другим.
 */
export function useSaveTierSettings(): UseMutationResult<TierSettings, Error, TierSettings> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<TierSettings>('/admin/settings/program/tiers', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(TIERS_KEY, saved)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card'] })
    },
  })
}
