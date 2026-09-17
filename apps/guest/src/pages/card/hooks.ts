import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  AcceptReferralResult,
  CreateGuestMessageInput,
  GuestMe,
  GuestMessageView,
  GuestMessages,
  GuestHistory,
  GuestNews,
  GuestNewsSeen,
  GuestNewsSeenInput,
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
  createMessage,
  createReview,
  fetchMe,
  fetchMessages,
  fetchHistory,
  fetchNews,
  fetchQrToken,
  fetchReferral,
  fetchReviews,
  fetchWallet,
  joinVenue,
  markNewsSeen,
  saveBirthday,
} from './card-api'

export const WALLET_QUERY_KEY = ['guest', 'wallet'] as const
export const QR_QUERY_KEY = ['guest', 'qr'] as const
export const ME_QUERY_KEY = ['guest', 'me'] as const
export const REVIEWS_QUERY_KEY = ['guest', 'reviews'] as const
export const NEWS_QUERY_KEY = ['guest', 'news'] as const
export const MESSAGES_QUERY_KEY = ['guest', 'messages'] as const
export const HISTORY_QUERY_KEY = ['guest', 'history'] as const

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

/** Свои обращения с ответами заведений. */
export function useGuestMessages(): UseQueryResult<GuestMessages, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: MESSAGES_QUERY_KEY,
    queryFn: () => fetchMessages(authGet),
    enabled: session !== null,
  })
}

/** Написать заведению. Список перечитывается: обращение должно появиться сразу. */
export function useCreateGuestMessage(): UseMutationResult<
  GuestMessageView,
  Error,
  CreateGuestMessageInput
> {
  const { authPost } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) => createMessage(authPost, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MESSAGES_QUERY_KEY })
    },
  })
}

/**
 * Отметка «увидел». Ответ не нужен никому на экране: гость просмотров не видит,
 * и неудача отметки не должна ломать ленту — поэтому без invalidate и без ошибок наружу.
 */
export function useMarkNewsSeen(): UseMutationResult<GuestNewsSeen, Error, GuestNewsSeenInput> {
  const { authPost } = useSession()

  return useMutation({
    mutationFn: (input) => markNewsSeen(authPost, input),
  })
}

/** Новости заведений. Свежесть в пределах минут не важна — лента не перечитывается сама. */
export function useGuestNews(): UseQueryResult<GuestNews, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: NEWS_QUERY_KEY,
    queryFn: () => fetchNews(authGet),
    enabled: session !== null,
  })
}

/**
 * История операций. Страница задаётся снаружи: «показать ещё» — это состояние
 * экрана, а не запроса, и запрос о нём знать не обязан.
 */
export function useHistory(offset: number): UseQueryResult<GuestHistory, Error> {
  const { authGet, session } = useSession()

  return useQuery({
    queryKey: [...HISTORY_QUERY_KEY, offset],
    queryFn: () => fetchHistory(authGet, offset),
    enabled: session !== null,
  })
}
