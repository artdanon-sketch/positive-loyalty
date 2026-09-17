import {
  AcceptReferralResult,
  GuestMe,
  GuestMessageView,
  GuestMessages,
  GuestHistory,
  GuestNews,
  GuestNewsSeen,
  GuestQrToken,
  GuestReferral,
  GuestReview,
  GuestReviews,
  GuestWallet,
  JoinVenueResult,
} from '@positive/contracts'
import type {
  CreateGuestMessageInput,
  CreateReviewInput,
  GuestNewsSeenInput,
  UpdateGuestProfileInput,
} from '@positive/contracts'
import type { ZodType } from 'zod'

/**
 * Источник данных карты.
 *
 * Отдельный модуль, а не функции внутри `hooks.ts`, ровно по одной причине:
 * тест должен уметь подменить запрос (отказ сети, вечная загрузка), не трогая
 * ни адресную строку, ни разметку экрана.
 */

type AuthGet = <T>(path: string, schema: ZodType<T>) => Promise<T>

type AuthPost = <T>(path: string, body: unknown, schema: ZodType<T>) => Promise<T>

type AuthPut = AuthPost

/** Кошелёк: баллы по всем заведениям острова (docs/02, раздел 2.1). */
export function fetchWallet(authGet: AuthGet): Promise<GuestWallet> {
  return authGet('/guest/wallet', GuestWallet)
}

/** Токен для показа на кассе. Живёт пять минут — обновляется по таймеру. */
export function fetchQrToken(authGet: AuthGet): Promise<GuestQrToken> {
  return authGet('/guest/qr-token', GuestQrToken)
}

/** Код приглашения в заведении и счётчики друзей (docs/02, раздел 2.5). */
export function fetchReferral(authGet: AuthGet, tenantId: string): Promise<GuestReferral> {
  return authGet(`/guest/venues/${encodeURIComponent(tenantId)}/referral`, GuestReferral)
}

/** Стать гостем заведения по приглашению друга. */
export function acceptReferral(
  authPost: AuthPost,
  tenantId: string,
  code: string,
): Promise<AcceptReferralResult> {
  return authPost(
    `/guest/venues/${encodeURIComponent(tenantId)}/referral/accept`,
    { code },
    AcceptReferralResult,
  )
}

/** Стать гостем заведения по ссылке источника: табличка, Instagram (docs/02, раздел 2.6). */
export function joinVenue(
  authPost: AuthPost,
  tenantId: string,
  channel: string,
): Promise<JoinVenueResult> {
  return authPost(
    `/guest/venues/${encodeURIComponent(tenantId)}/join`,
    { channel },
    JoinVenueResult,
  )
}

/** Профиль гостя: здесь нужен ради дня рождения (docs/02, раздел 2.7). */
export function fetchMe(authGet: AuthGet): Promise<GuestMe> {
  return authGet('/guest/me', GuestMe)
}

/** Указать день рождения — один раз. */
export function saveBirthday(authPut: AuthPut, date: string): Promise<GuestMe> {
  return authPut('/guest/me/birthday', { date }, GuestMe)
}

/** Визиты, которые можно оценить, и свои отзывы с ответами (docs/02, раздел 2.8). */
export function fetchReviews(authGet: AuthGet): Promise<GuestReviews> {
  return authGet('/guest/reviews', GuestReviews)
}

/** Оценить визит. */
export function createReview(authPost: AuthPost, input: CreateReviewInput): Promise<GuestReview> {
  return authPost('/guest/reviews', input, GuestReview)
}

/** Новости заведений гостя — одна лента на все (docs/02, раздел 2.9). */
export function fetchNews(authGet: AuthGet): Promise<GuestNews> {
  return authGet('/guest/news', GuestNews)
}

/** Имя и язык гостя (docs/02, раздел 2.12). */
export function saveProfile(authPut: AuthPut, input: UpdateGuestProfileInput): Promise<GuestMe> {
  return authPut('/guest/me', input, GuestMe)
}

/**
 * История начислений и списаний (docs/02, раздел 2.11).
 *
 * Страницами: карта показывает первые двадцать, дальше — «показать ещё».
 * Тянуть всю историю разом значит заставить телефон у стойки ждать ради строк,
 * до которых гость обычно не доходит.
 */
export function fetchHistory(authGet: AuthGet, offset: number): Promise<GuestHistory> {
  return authGet(`/guest/history?offset=${String(offset)}`, GuestHistory)
}

/** Свои жалобы и предложения с ответами заведений (docs/02, раздел 2.10). */
export function fetchMessages(authGet: AuthGet): Promise<GuestMessages> {
  return authGet('/guest/messages', GuestMessages)
}

/** Написать заведению: жалоба или предложение. */
export function createMessage(
  authPost: AuthPost,
  input: CreateGuestMessageInput,
): Promise<GuestMessageView> {
  return authPost('/guest/messages', input, GuestMessageView)
}

/** Отметить показанные новости увиденными — пачкой, одним запросом. */
export function markNewsSeen(
  authPost: AuthPost,
  input: GuestNewsSeenInput,
): Promise<GuestNewsSeen> {
  return authPost('/guest/news/seen', input, GuestNewsSeen)
}
