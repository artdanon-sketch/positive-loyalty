import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useSecurityHistory } from '../hooks'
import { ACTOR_LABELS, actionLabel } from '../labels'

/**
 * Вкладка «История действий». docs/03, раздел 9 · docs/11, У12.
 *
 * Кто, что и когда — без значений «было / стало»: их сервер не отдаёт. Листается назад
 * страницами: «Раньше» берёт момент последнего события, «К свежим» возвращает в начало.
 */
export function HistoryView(): ReactElement {
  const t = useT()
  const [before, setBefore] = useState<string | null>(null)
  const history = useSecurityHistory(before)

  if (history.isPending) {
    return (
      <p className="state__hint" role="status">
        {t('common.loading')}
      </p>
    )
  }

  if (history.isError) {
    return (
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
    )
  }

  const { items, nextBefore } = history.data

  return (
    <section className="panel" aria-labelledby="security-history-title">
      <h2 className="panel__title" id="security-history-title">
        {t('security.tab.history')}
      </h2>

      {items.length === 0 ? (
        <p className="state__hint">{t('security.history.empty')}</p>
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
              setBefore(null)
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
              setBefore(nextBefore)
            }}
          >
            {t('security.history.earlier')}
          </button>
        )}
      </div>
    </section>
  )
}
