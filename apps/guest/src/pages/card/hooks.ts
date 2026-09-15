import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  AcceptReferralResult,
  GuestMe,
  GuestQrToken,
  CreateReviewInput,
  GuestReferral,
  GuestReview,
  GuestReviews,
  GuestWallet,
  JoinVenueResult,
} from '@positive/contracts'

import type { PendingInvite } from '../../shared/invite/pending-invite'
import { useSession } from '../../shared/session/session-context'
import {
  acceptReferral,
  createReview,
  fetchMe,
  fetchQrToken,
  fetchReferral,
  fetchReviews,
  fetchWallet,
  joinVenue,
  saveBirthday,
} from './card-api'

export const WALLET_QUERY_KEY = ['guest', 'wallet'] as const
export const QR_QUERY_KEY = ['guest', 'qr'] as const
export const ME_QUERY_KEY = ['guest', 'me'] as const
export const REVIEWS_QUERY_KEY = ['guest', 'reviews'] as const

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

/**
 * Код приглашения — по нажатию «Пригласить друга», а не при открытии карты:
 * сервер заводит код при первом запросе, и заводить его каждому гостю незачем.
 */
export function useReferral(
  tenantId: string,
  enabled: boolean,
): UseQueryResult<GuestReferral, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: ['guest', 'referral', tenantId],
    queryFn: () => fetchReferral(authGet, tenantId),
    enabled: enabled && session !== null,
  })
}

/**
 * Принять ссылку, открытую до входа: приглашение друга или ссылку источника.
 * Ответы у обоих одного вида. После — кошелёк перечитывается: в нём новое заведение.
 */
export function useClaimInvite(): UseMutationResult<
  AcceptReferralResult | JoinVenueResult,
  Error,
  PendingInvite
> {
  const { authPost } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (invite) =>
      invite.kind === 'channel'
        ? joinVenue(authPost, invite.tenantId, invite.code)
        : acceptReferral(authPost, invite.tenantId, invite.code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WALLET_QUERY_KEY })
    },
  })
}

/** Профиль гостя — ради вопроса о дне рождения. */
export function useMe(): UseQueryResult<GuestMe, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => fetchMe(authGet),
    enabled: session !== null,
  })
}

/**
 * Сохранить день рождения. Кошелёк перечитывается: если праздник уже в окне,
 * сервер выдаст подарок при следующем открытии кошелька — то есть прямо сейчас.
 */
export function useSaveBirthday(): UseMutationResult<GuestMe, Error, string> {
  const { authPut } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (date) => saveBirthday(authPut, date),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_QUERY_KEY, me)
      void queryClient.invalidateQueries({ queryKey: WALLET_QUERY_KEY })
    },
  })
}

/** «Оцените визит» и ответы заведений — один запрос на оба блока. */
export function useGuestReviews(): UseQueryResult<GuestReviews, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: REVIEWS_QUERY_KEY,
    queryFn: () => fetchReviews(authGet),
    enabled: session !== null,
  })
}

/** Оценить визит. После — отзывы перечитываются: визит уходит из «оцените», ответ — в список. */
export function useCreateReview(): UseMutationResult<GuestReview, Error, CreateReviewInput> {
  const { authPost } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) => createReview(authPost, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEWS_QUERY_KEY })
    },
  })
}
