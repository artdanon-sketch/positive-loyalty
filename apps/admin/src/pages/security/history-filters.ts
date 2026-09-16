/**
 * Фильтры истории действий: день заведения и сотрудник. docs/03, раздел 9.
 *
 * ПУСТОЙ ФИЛЬТР НЕ ПОПАДАЕТ В АДРЕС. Иначе один и тот же экран просил бы у сервера
 * два разных адреса («?day=» и без него), а кеш держал бы два ответа на один вопрос.
 *
 * ДЕНЬ УХОДИТ КАК ЕСТЬ, `YYYY-MM-DD`: сутки считает сервер по часам заведения,
 * и любой пересчёт на клиенте сдвинул бы границу.
 */

export interface HistoryFilters {
  /** Сутки заведения, `YYYY-MM-DD`. null — все дни. */
  day: string | null
  /** Сотрудник заведения. null — все. */
  actorId: string | null
}

export const NO_HISTORY_FILTERS: HistoryFilters = { day: null, actorId: null }

export function isFiltered(filters: HistoryFilters): boolean {
  return filters.day !== null || filters.actorId !== null
}

/** Адрес страницы истории: `before` — момент, раньше которого события (null — свежие). */
export function historyPath(filters: HistoryFilters, before: string | null): string {
  const query = new URLSearchParams()

  if (before !== null) {
    query.set('before', before)
  }

  if (filters.day !== null) {
    query.set('day', filters.day)
  }

  if (filters.actorId !== null) {
    query.set('actorId', filters.actorId)
  }

  const tail = query.toString()

  return tail === '' ? '/admin/security/history' : `/admin/security/history?${tail}`
}
