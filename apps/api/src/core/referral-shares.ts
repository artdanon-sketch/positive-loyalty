/**
 * Ключи журнала для наград за друзей. docs/02, раздел 5.6.2.
 *
 * Обе награды пишутся в журнал как GRANT с `refType = 'referral'`, и различает
 * их только ключ идемпотентности. Отдельный тип ссылки был бы чище, но менять
 * перечень ссылок журнала ради счётчика — дороже, чем договориться о префиксах.
 *
 * - разовая награда — `referral:{участие друга}`: одна на друга навсегда;
 * - процент с покупки — `referral-share:{участие друга}:{чек}:{круг}`: по одной
 *   на круг с каждого чека. Повтор чека любым путём — касса, вебхук, досылка —
 *   упирается в тот же ключ и второй раз не платит.
 *
 * ПРЕФИКСЫ НЕ ПЕРЕСЕКАЮТСЯ: `referral-share:` не начинается с `referral:` —
 * после «referral» идёт дефис, а не двоеточие. Поэтому «за скольких получил
 * разовую награду» считается по `startsWith('referral:')` и процентов не видит.
 */

export const REFERRAL_REWARD_KEY_PREFIX = 'referral:'

export const referralRewardKey = (friendMembershipId: string): string =>
  `${REFERRAL_REWARD_KEY_PREFIX}${friendMembershipId}`

/** Все проценты одного чека одного друга — для отмены чека. */
export const referralSharePrefix = (friendMembershipId: string, receiptId: string): string =>
  `referral-share:${friendMembershipId}:${receiptId}:`

export const referralShareKey = (
  friendMembershipId: string,
  receiptId: string,
  level: number,
): string => `${referralSharePrefix(friendMembershipId, receiptId)}${String(level)}`

/** Процент с покупки на одном круге. Округление вниз — в пользу заведения. */
export const referralShareAmount = (basisAmount: number, pct: number): number =>
  Math.floor((basisAmount * pct) / 100)
