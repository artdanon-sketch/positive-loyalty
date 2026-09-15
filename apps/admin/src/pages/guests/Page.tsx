import { useState } from 'react'
import type { ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '../../shared/auth/auth-context'
import { formatBaht, formatDate, formatDateTime } from '../../shared/format/format'
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value'
import { useT } from '../../shared/i18n'
import { GuestCard } from './components/guest-card'
import { GuestExport } from './components/guest-export'
import { GuestFiltersBar } from './components/guest-filters'
import { SearchBox } from './components/search-box'
import { filterParams, filtersFromParams, hasFilters, writeFilters } from './filters'
import type { GuestFilters } from './filters'
import { GUESTS_PAGE_SIZE, useGuestsPage, useTierOptions } from './hooks'
import { SOURCE_LABELS } from './labels'

/**
 * Экран «Гости»: кто участвует в программе, поиск, фильтры и карточка гостя.
 * docs/03, раздел 3 · docs/10, раздел 5.2 · docs/11, У4.
 *
 * ЗАПРОС, ФИЛЬТРЫ И ОТКРЫТАЯ КАРТОЧКА ЖИВУТ В АДРЕСЕ СТРАНИЦЫ
 * (`?q=4821&mode=RESIDENT&guest=…`). Так поиск из шапки попадает сюда уже
 * набранным, ссылку «спящие резиденты» можно переслать управляющему,
 * а перезагрузка не теряет, на ком остановились.
 *
 * Телефон приходит с сервера уже в том виде, который положен роли:
 * менеджеру — маска, владельцу — целиком. Клиент его только показывает.
 *
 * Фильтр по статусу и выгрузка — у владельца: лестница статусов в настройках
 * программы, а выгрузка базы — его право (docs/05).
 */

const SEARCH_DELAY_MS = 250

export function GuestsPage(): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const openGuestId = params.get('guest')
  const filters = filtersFromParams(params)
  const search = useDebouncedValue(q.trim(), SEARCH_DELAY_MS)
  const tierOptions = useTierOptions(isOwner)

  // Страница помнит, к какому запросу относится: новый поиск или фильтр
  // начинается с первой страницы, а не с той, на которой листали прошлый.
  const pageKey = JSON.stringify([search, filterParams(filters)])
  const [paging, setPaging] = useState({ key: pageKey, offset: 0 })
  const offset = paging.key === pageKey ? paging.offset : 0
  const query = useGuestsPage(offset, search, filters)
  const narrowed = search !== '' || hasFilters(filters)

  const setOffset = (next: number): void => {
    setPaging({ key: pageKey, offset: next })
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

  const setFilters = (value: GuestFilters): void => {
    updateParams((next) => {
      writeFilters(next, value)
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

      <GuestFiltersBar
        filters={filters}
        tiers={tierOptions.data?.tiers ?? null}
        onChange={setFilters}
      />

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
        narrowed ? (
          <div className="state" role="status">
            <p className="state__title">{t('guests.search.nothing')}</p>
            <p className="state__hint">
              {t(search === '' ? 'guests.filter.nothingHint' : 'guests.search.nothingHint')}
            </p>
          </div>
        ) : (
          <div className="state">
            <p className="state__title">{t('guests.empty.title')}</p>
            <p className="state__hint">{t('guests.empty.hint')}</p>
          </div>
        )
      ) : (
        <>
          {narrowed || isOwner ? (
            <div className="guests-toolbar">
              {narrowed ? (
                <p className="search__found" role="status">
                  {t('guests.search.found')}: {query.data.total}
                </p>
              ) : (
                <span />
              )}
              {isOwner ? <GuestExport filters={filters} search={search} /> : null}
            </div>
          ) : null}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('guests.col.guest')}</th>
                  <th>{t('guests.col.phone')}</th>
                  <th>{t('guests.col.mode')}</th>
                  <th>{t('guests.col.tier')}</th>
                  <th className="data-table__num">{t('guests.col.points')}</th>
                  <th className="data-table__num">{t('guests.col.visits')}</th>
                  <th className="data-table__num">{t('guests.col.spent')}</th>
                  <th>{t('guests.col.lastVisit')}</th>
                  <th>{t('guests.col.since')}</th>
                  <th>{t('guests.col.source')}</th>
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
                    <td>
                      {row.tier === null ? (
                        '—'
                      ) : (
                        <span className="chip chip--good">{row.tier.name}</span>
                      )}
                    </td>
                    <td className="data-table__num">{formatBaht(row.pointsBalance)}</td>
                    <td className="data-table__num">{row.visitsTotal}</td>
                    <td className="data-table__num">{formatBaht(row.spentTotal)}</td>
                    <td>{formatDateTime(row.lastVisitAt)}</td>
                    <td>{formatDate(row.firstVisitAt)}</td>
                    <td>{t(SOURCE_LABELS[row.source])}</td>
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
