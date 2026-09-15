import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import type {
  CreateOfferInput,
  OfferChangeResult,
  OfferSimulation,
  SimulateOfferInput,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Собрать акцию. Список акций после этого перечитывается: цифры и кнопки считает сервер. */
export function useCreateOffer(): UseMutationResult<OfferChangeResult, Error, CreateOfferInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<OfferChangeResult>('/admin/offers', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] })
    },
  })
}

/** Прогноз на истории заведения. Ничего не меняет — поэтому и кэш не трогает. */
export function useSimulateOffer(): UseMutationResult<OfferSimulation, Error, SimulateOfferInput> {
  const { authFetch } = useAuth()

  return useMutation({
    mutationFn: (rules) =>
      authFetch<OfferSimulation>('/admin/offers/simulate', {
        method: 'POST',
        body: JSON.stringify(rules),
        headers: { 'Content-Type': 'application/json' },
      }),
  })
}
