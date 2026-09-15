import { AcceptReferralResult, GuestQrToken, GuestReferral, GuestWallet } from '@positive/contracts'
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
