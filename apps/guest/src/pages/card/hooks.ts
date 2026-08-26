import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'

import { fetchCard, type GuestCard } from './card-api'

export const CARD_QUERY_KEY = ['guest', 'card'] as const

/**
 * Карта гостя. Состояние экрана — производная от состояния запроса:
 * `isPending` → загрузка, `isError` → ошибка, иначе — данные (пока всегда пустые).
 */
export function useCard(): UseQueryResult<GuestCard, Error> {
  return useQuery({ queryKey: CARD_QUERY_KEY, queryFn: fetchCard })
}
