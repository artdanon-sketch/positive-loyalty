import type { CashierSignal, SecurityActorType } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n'

/**
 * Подписи разбора безопасности. docs/11, У12.
 *
 * Действия аудита — машиночитаемые коды (core/audit.service.ts). Владельцу нужны слова;
 * код, которого здесь ещё нет, показывается как есть — лучше непонятная строка, чем пропавшее
 * событие.
 */

const ACTIONS: Readonly<Record<string, TranslationKey>> = {
  IMPERSONATE_START: 'security.action.IMPERSONATE_START',
  IMPERSONATE_END: 'security.action.IMPERSONATE_END',
  PHONE_REVEALED: 'security.action.PHONE_REVEALED',
  BALANCE_ADJUSTED: 'security.action.BALANCE_ADJUSTED',
  OPERATION_REVERSED: 'security.action.OPERATION_REVERSED',
  PROGRAM_CONFIG_CHANGED: 'security.action.PROGRAM_CONFIG_CHANGED',
  DATABASE_EXPORTED: 'security.action.DATABASE_EXPORTED',
  STAFF_CREATED: 'security.action.STAFF_CREATED',
  STAFF_UPDATED: 'security.action.STAFF_UPDATED',
  STAFF_PIN_RESET: 'security.action.STAFF_PIN_RESET',
  GIFT_ISSUED: 'security.action.GIFT_ISSUED',
  INVITE_SPAM_REPORTED: 'security.action.INVITE_SPAM_REPORTED',
  INVITE_COMPLAINTS_REVIEWED: 'security.action.INVITE_COMPLAINTS_REVIEWED',
  OFFER_CREATED: 'security.action.OFFER_CREATED',
  OFFER_STATUS_CHANGED: 'security.action.OFFER_STATUS_CHANGED',
  GUEST_TIER_CHANGED: 'security.action.GUEST_TIER_CHANGED',
  CERTIFICATE_CREATED: 'security.action.CERTIFICATE_CREATED',
  CERTIFICATE_UPDATED: 'security.action.CERTIFICATE_UPDATED',
  REVIEW_REPLIED: 'security.action.REVIEW_REPLIED',
  GUEST_MESSAGE_REPLIED: 'security.action.GUEST_MESSAGE_REPLIED',
  BROADCAST_CREATED: 'security.action.BROADCAST_CREATED',
  AUTOMATION_CHANGED: 'security.action.AUTOMATION_CHANGED',
}

export const actionLabel = (action: string, t: (key: TranslationKey) => string): string => {
  const key = ACTIONS[action]
  return key === undefined ? action : t(key)
}

export const ACTOR_LABELS: Readonly<Record<SecurityActorType, TranslationKey>> = {
  SYSTEM: 'security.actor.SYSTEM',
  GUEST: 'security.actor.GUEST',
  CASHIER: 'security.actor.CASHIER',
  MANAGER: 'security.actor.MANAGER',
  OWNER: 'security.actor.OWNER',
  PLATFORM_ADMIN: 'security.actor.PLATFORM_ADMIN',
}

export const SIGNAL_LABELS: Readonly<Record<CashierSignal, TranslationKey>> = {
  SELF_LINKED: 'security.signal.SELF_LINKED',
  BURST: 'security.signal.BURST',
}

/** «2026-09-15» → «15.09.2026»: день заведения показывается как есть, без часового пояса. */
export const dayLabel = (day: string): string => {
  const [year, month, date] = day.split('-')
  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}
