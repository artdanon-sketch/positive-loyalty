import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { GuestQrToken, GuestWallet } from '@positive/contracts'

import { useSession } from '../../shared/session/session-context'
import { fetchQrToken, fetchWallet } from './card-api'

export const WALLET_QUERY_KEY = ['guest', 'wallet'] as const
export const QR_QUERY_KEY = ['guest', 'qr'] as const

/**
 * Кошелёк. Состояние экрана — производная от состояния запроса:
 * `isPending` → загрузка, `isError` → ошибка, иначе данные.
 */
export function useWallet(): UseQueryResult<GuestWallet, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: WALLET_QUERY_KEY,
    queryFn: () => fetchWallet(authGet),
    enabled: session !== null,
  })
}

/**
 * Токен для кассы. Обновляется за полминуты до истечения: показать кассиру
 * просроченный код — значит заставить гостя тыкать «обновить» у стойки.
 */
export function useQrToken(): UseQueryResult<GuestQrToken, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: QR_QUERY_KEY,
    queryFn: () => fetchQrToken(authGet),
    enabled: session !== null,
    refetchInterval: (query) => {
      const ttl = query.state.data?.expiresIn
      return ttl === undefined ? false : Math.max(30, ttl - 30) * 1000
    },
    // Экран карты открыт у кассы — свежесть кода важнее экономии запросов.
    staleTime: 0,
  })
}
