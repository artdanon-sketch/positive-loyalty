import { useState } from 'react'
import type { ReactElement } from 'react'
import type { SecurityEvent } from '@positive/contracts'

import { formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useTeam } from '../../team/hooks'
import { isFiltered, NO_HISTORY_FILTERS } from '../history-filters'
import type { HistoryFilters } from '../history-filters'
import { useSecurityHistory } from '../hooks'
import { ACTOR_LABELS, actionLabel } from '../labels'

/**
 * Вкладка «История действий». docs/03, раздел 9 · docs/11, У12.
 *
 * Кто, что и когда — без значений «было / стало»: их сервер не отдаёт. Листается назад
 * страницами: «Раньше» берёт момент последнего события, «К свежим» возвращает в начало.
 *
 * ФИЛЬТРЫ СВЕРХУ, А НЕ ПОИСК ПО СТРАНИЦЕ: разбор начинается с «что было в ту субботу»
 * или «что делал этот кассир», и отсев на клиенте показал бы только текущие пятьдесят строк.
 *
 * ФИЛЬТРЫ ОСТАЮТСЯ НА ЭКРАНЕ И В ЗАГРУЗКЕ, И В ОШИБКЕ: убери их — и владелец теряет
 * то, что только что выбрал, вместе со способом это исправить.
 */
export function HistoryView(): ReactElement {
  const t = useT()
  const [filters, setFilters] = useState<HistoryFilters>(NO_HISTORY_FILTERS)
  const [before, setBefore] = useState<string | null>(null)
  const history = useSecurityHistory(filters, before)
  const team = useTeam()

  // Новый фильтр — всегда со свежих: «раньше» от прошлой выборки к новой не относится.
  const narrow = (next: HistoryFilters): void => {
    setFilters(next)
    setBefore(null)
  }

  const controls = (
    <div className="guest-filters" role="group" aria-label={t('security.filter.label')}>
      <div className="field">
        <label className="field__label" htmlFor="security-filter-day">
          {t('security.filter.day')}
        </label>
        <input
          id="security-filter-day"
          className="field__input field__input--compact"
          type="date"
          value={filters.day ?? ''}
          onChange={(event) => {
            narrow({ ...filters, day: event.target.value === '' ? null : event.target.value })
          }}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="security-filter-staff">
          {t('security.filter.staff')}
        </label>
        <select
          id="security-filter-staff"
          className="field__input field__input--compact"
          value={filters.actorId ?? ''}
          onChange={(event) => {
            narrow({ ...filters, actorId: event.target.value === '' ? null : event.target.value })
          }}
        >
          <option value="">{t('security.filter.everyone')}</option>
          {(team.data ?? []).map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </div>
      {isFiltered(filters) ? (
        <button
          className="button guest-filters__toggle"
          type="button"
          onClick={() => {
            narrow(NO_HISTORY_FILTERS)
          }}
        >
          {t('security.filter.reset')}
        </button>
      ) : null}
    </div>
  )

  return (
    <section className="panel" aria-labelledby="security-history-title">
      <h2 className="panel__title" id="security-history-title">
        {t('security.tab.history')}
      </h2>

      {controls}

      {history.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : history.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{history.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void history.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <HistoryTable
          before={before}
          filtered={isFiltered(filters)}
          items={history.data.items}
          nextBefore={history.data.nextBefore}
          onPage={setBefore}
        />
      )}
    </section>
  )
}

function HistoryTable({
  before,
  filtered,
  items,
  nextBefore,
  onPage,
}: {
  before: string | null
  filtered: boolean
  items: readonly SecurityEvent[]
  nextBefore: string | null
  onPage: (next: string | null) => void
}): ReactElement {
  const t = useT()

  return (
    <>
      {items.length === 0 ? (
        <p className="state__hint">
          {filtered ? t('security.history.nothingFound') : t('security.history.empty')}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table" aria-labelledby="security-history-title">
            <thead>
              <tr>
                <th>{t('security.col.when')}</th>
                <th>{t('security.col.who')}</th>
                <th>{t('security.col.what')}</th>
                <th>{t('security.col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.occurredAt)}</td>
                  <td>{item.actor?.displayName ?? t(ACTOR_LABELS[item.actorType])}</td>
                  <td>{actionLabel(item.action, t)}</td>
                  <td>{item.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        {before === null ? null : (
          <button
            className="button"
            type="button"
            onClick={() => {
              onPage(null)
            }}
          >
            {t('security.history.latest')}
          </button>
        )}
        {nextBefore === null ? null : (
          <button
            className="button"
            type="button"
            onClick={() => {
              onPage(nextBefore)
            }}
          >
            {t('security.history.earlier')}
          </button>
        )}
      </div>
    </>
  )
}
