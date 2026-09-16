import { ADMIN_MESSAGES_PAGE } from '@positive/contracts'
import type { GuestMessageKind } from '@positive/contracts'

/**
 * Фильтры списка жалоб и предложений. docs/02, раздел 5.15.
 *
 * ПУСТОЙ ФИЛЬТР НЕ ПОПАДАЕТ В АДРЕС: иначе один и тот же вопрос уходил бы к серверу
 * двумя разными адресами, а кеш держал бы два ответа на него.
 */

export const MESSAGES_PAGE = ADMIN_MESSAGES_PAGE

export interface MessageFilters {
  /** null — оба вида. */
  kind: GuestMessageKind | null
  /** 'no' — только без ответа, 'yes' — только отвеченные, null — все. */
  answered: 'yes' | 'no' | null
}

export const NO_MESSAGE_FILTERS: MessageFilters = { kind: null, answered: null }

export function messagesPath(filters: MessageFilters, offset: number): string {
  const query = new URLSearchParams()

  if (filters.kind !== null) {
    query.set('kind', filters.kind)
  }

  if (filters.answered !== null) {
    query.set('answered', filters.answered)
  }

  if (offset > 0) {
    query.set('offset', String(offset))
  }

  const tail = query.toString()

  return tail === '' ? '/admin/messages' : `/admin/messages?${tail}`
}
