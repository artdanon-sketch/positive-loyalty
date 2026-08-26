import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatBaht, formatDateTime } from '../../shared/format/format'
import { useT } from '../../shared/i18n'
import { GUESTS_PAGE_SIZE, useGuestsPage } from './hooks'

/**
 * Экран «Гости»: кто участвует в программе и когда был.
 * docs/03, раздел 3 — в объёме Среза 1: список без карточки гостя и сегментов.
 *
 * Телефон приходит с сервера уже в том виде, который положен роли:
 * менеджеру — маска, владельцу — целиком. Клиент его только показывает.
 */
export function GuestsPage(): ReactElement {
  const t = useT()
  const [offset, setOffset] = useState(0)
  const query = useGuestsPage(offset)

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('guests.title')}</h1>
        <p className="page__subtitle">{t('guests.subtitle')}</p>
      </header>

      {query.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : query.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{query.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void query.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : query.data.items.length === 0 ? (
        <div className="state">
          <p className="state__title">{t('guests.empty.title')}</p>
          <p className="state__hint">{t('guests.empty.hint')}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('guests.col.guest')}</th>
                  <th>{t('guests.col.phone')}</th>
                  <th>{t('guests.col.mode')}</th>
                  <th className="data-table__num">{t('guests.col.points')}</th>
                  <th className="data-table__num">{t('guests.col.visits')}</th>
                  <th className="data-table__num">{t('guests.col.spent')}</th>
                  <th>{t('guests.col.lastVisit')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr key={row.membershipId}>
                    <td>{row.displayName ?? t('guests.noName')}</td>
                    <td className="data-table__mono">{row.phone}</td>
                    <td>
                      <span
                        className={`chip ${row.mode === 'TOURIST' ? 'chip--neutral' : 'chip--good'}`}
                      >
                        {t(row.mode === 'TOURIST' ? 'guests.mode.tourist' : 'guests.mode.resident')}
                      </span>
                      {row.isControlGroup ? (
                        <span className="chip chip--muted">{t('guests.controlGroup')}</span>
                      ) : null}
                    </td>
                    <td className="data-table__num">{formatBaht(row.pointsBalance)}</td>
                    <td className="data-table__num">{row.visitsTotal}</td>
                    <td className="data-table__num">{formatBaht(row.spentTotal)}</td>
                    <td>{formatDateTime(row.lastVisitAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="pager" aria-label={t('common.pager.label')}>
            <button
              className="button"
              type="button"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - GUESTS_PAGE_SIZE))
              }}
            >
              {t('common.pager.prev')}
            </button>
            <span className="pager__info">
              {offset + 1}–{offset + query.data.items.length} {t('common.pager.of')}{' '}
              {query.data.total}
            </span>
            <button
              className="button"
              type="button"
              disabled={offset + query.data.items.length >= query.data.total}
              onClick={() => {
                setOffset(offset + GUESTS_PAGE_SIZE)
              }}
            >
              {t('common.pager.next')}
            </button>
          </nav>
        </>
      )}
    </section>
  )
}
