import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  AdminGuestCard,
  AdminGuestsList,
  GuestExportInput,
  IssueGiftInput,
  IssueGiftResult,
  TierSettings,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { useLocale } from '../../shared/i18n'
import { filterParams } from './filters'
import type { GuestFilters } from './filters'

export const GUESTS_PAGE_SIZE = 20

export function useGuestsPage(
  offset: number,
  search: string,
  filters: GuestFilters,
): UseQueryResult<AdminGuestsList, Error> {
  const { authFetch } = useAuth()
  const extra = filterParams(filters)

  return useQuery({
    queryKey: ['admin', 'guests', search, offset, extra],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(GUESTS_PAGE_SIZE),
        offset: String(offset),
      })

      if (search !== '') {
        params.set('q', search)
      }

      for (const [key, value] of extra) {
        params.set(key, value)
      }

      return authFetch<AdminGuestsList>(`/admin/guests?${params.toString()}`)
    },
    placeholderData: keepPreviousData,
  })
}

/**
 * Лестница статусов для фильтра. Только владельцу: настройки программы его,
 * и менеджер получил бы отказ — запрос у него не отправляется вовсе.
 * Ключ кэша общий с экраном настроек.
 */
export function useTierOptions(enabled: boolean): UseQueryResult<TierSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'settings', 'tiers'],
    queryFn: () => authFetch<TierSettings>('/admin/settings/program/tiers'),
    enabled,
  })
}

/**
 * Выгрузка гостей. Ответ — текст CSV, а не JSON, поэтому через authStream:
 * тот отдаёт ответ целиком, с тем же обновлением токена, что и authFetch.
 */
export function useExportGuests(): UseMutationResult<string, Error, GuestExportInput> {
  const { authStream } = useAuth()

  return useMutation({
    mutationFn: async (input) => {
      const response = await authStream('/admin/guests/export', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      })

      return response.text()
    },
  })
}

/** Карточка гостя. Названия подарков — на языке интерфейса того, кто смотрит. */
export function useGuestCard(guestId: string): UseQueryResult<AdminGuestCard, Error> {
  const { authFetch } = useAuth()
  const locale = useLocale()

  return useQuery({
    queryKey: ['admin', 'guest-card', guestId, locale],
    queryFn: () =>
      authFetch<AdminGuestCard>(`/admin/guests/${encodeURIComponent(guestId)}?locale=${locale}`),
  })
}

/**
 * Подарить гостю. Ключ повтора приходит от формы: один ключ на одно намерение.
 * После подарка карточка перечитывается — подарок сразу виден в истории.
 */
export function useIssueGift(
  guestId: string,
): UseMutationResult<IssueGiftResult, Error, { key: string; input: IssueGiftInput }> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, input }) =>
      authFetch<IssueGiftResult>(`/admin/guests/${encodeURIComponent(guestId)}/gifts`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card', guestId] })
    },
  })
}
