import { useState } from 'react'
import type { ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'

import { formatBaht, formatDateTime } from '../../shared/format/format'
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value'
import { useT } from '../../shared/i18n'
import { GuestCard } from './components/guest-card'
import { SearchBox } from './components/search-box'
import { GUESTS_PAGE_SIZE, useGuestsPage } from './hooks'

/**
 * Экран «Гости»: кто участвует в программе, поиск и карточка гостя.
 * docs/03, раздел 3 · docs/10, раздел 5.2.
 *
 * ЗАПРОС И ОТКРЫТАЯ КАРТОЧКА ЖИВУТ В АДРЕСЕ СТРАНИЦЫ (`?q=4821&guest=…`).
 * Так поиск из шапки попадает сюда уже набранным, ссылку на гостя можно
 * переслать управляющему, а перезагрузка не теряет, на ком остановились.
 *
 * Телефон приходит с сервера уже в том виде, который положен роли:
 * менеджеру — маска, владельцу — целиком. Клиент его только показывает.
 */

const SEARCH_DELAY_MS = 250

export function GuestsPage(): ReactElement {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const openGuestId = params.get('guest')
  const search = useDebouncedValue(q.trim(), SEARCH_DELAY_MS)

  // Страница помнит, к какому запросу относится: новый поиск начинается
  // с первой страницы, а не с той, на которой листали прошлый.
  const [paging, setPaging] = useState({ search, offset: 0 })
  const offset = paging.search === search ? paging.offset : 0
  const query = useGuestsPage(offset, search)

  const setOffset = (next: number): void => {
    setPaging({ search, offset: next })
  }

  const updateParams = (change: (next: URLSearchParams) => void): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        change(next)
        return next
      },
      { replace: true },
    )
  }

  const setQuery = (value: string): void => {
    updateParams((next) => {
      if (value === '') {
        next.delete('q')
      } else {
        next.set('q', value)
      }
    })
  }

  const openCard = (guestId: string): void => {
    updateParams((next) => {
      next.set('guest', guestId)
    })
  }

  const closeCard = (): void => {
    updateParams((next) => {
      next.delete('guest')
    })
  }

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('guests.title')}</h1>
        <p className="page__subtitle">{t('guests.subtitle')}</p>
      </header>

      <SearchBox value={q} onChange={setQuery} />

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
        search === '' ? (
          <div className="state">
            <p className="state__title">{t('guests.empty.title')}</p>
            <p className="state__hint">{t('guests.empty.hint')}</p>
          </div>
        ) : (
          <div className="state" role="status">
            <p className="state__title">{t('guests.search.nothing')}</p>
            <p className="state__hint">{t('guests.search.nothingHint')}</p>
          </div>
        )
      ) : (
        <>
          {search === '' ? null : (
            <p className="search__found" role="status">
              {t('guests.search.found')}: {query.data.total}
            </p>
          )}

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
                    <td>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => {
                          openCard(row.guestId)
                        }}
                      >
                        {row.displayName ?? t('guests.noName')}
                      </button>
                    </td>
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

      {openGuestId === null ? null : (
        <GuestCard key={openGuestId} guestId={openGuestId} onClose={closeCard} />
      )}
    </section>
  )
}
