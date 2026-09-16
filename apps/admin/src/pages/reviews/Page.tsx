import { useState } from 'react'
import type { ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { PERIODS } from '../overview/hooks'
import { ReviewCard } from './components/review-card'
import { MessagesView } from './components/messages-view'
import { NewsView } from './components/news-view'
import { ReviewSummaryView } from './components/review-summary'
import { filtersFromParams, REVIEWS_PAGE, writeFilters } from './filters'
import type { ReviewAnswered, ReviewFilters } from './filters'
import { useReviews } from './hooks'

/**
 * Экран «Отзывы» — `/reviews`. docs/03 · docs/11, У10.
 *
 * Сводка сверху, список ниже, ответ — прямо в карточке отзыва. Фильтры по оценке
 * и ответу живут в адресе, период — как в отчётах, месяц по умолчанию.
 *
 * Отдельный пункт меню, а не вкладка «Гостей»: на отзывы отвечают каждый день,
 * и путь к ним должен быть в один клик.
 */

const PERIOD_LABEL: Readonly<Record<DashboardPeriod, TranslationKey>> = {
  '7d': 'overview.period.7d',
  '30d': 'overview.period.30d',
  '90d': 'overview.period.90d',
}

const RATING_OPTIONS = [null, 5, 4, 3, 2, 1] as const

const ANSWERED_OPTIONS: ReadonlyArray<{ value: ReviewAnswered | null; label: TranslationKey }> = [
  { value: null, label: 'reviews.filter.all' },
  { value: 'no', label: 'reviews.filter.unanswered' },
  { value: 'yes', label: 'reviews.filter.answered' },
]

type CommunicationTab = 'reviews' | 'messages' | 'news'

const COMMUNICATION_TABS: ReadonlyArray<{ value: CommunicationTab; label: TranslationKey }> = [
  { value: 'reviews', label: 'communication.tab.reviews' },
  { value: 'messages', label: 'communication.tab.messages' },
  { value: 'news', label: 'communication.tab.news' },
]

/** Вкладка из адреса: ссылку на жалобы можно переслать так же, как на новости. */
const tabFromParams = (value: string | null): CommunicationTab =>
  value === 'news' || value === 'messages' ? value : 'reviews'

export function ReviewsPage(): ReactElement {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const tab = tabFromParams(params.get('tab'))
  const filters = filtersFromParams(params)
  const [period, setPeriod] = useState<DashboardPeriod>('30d')

  // Страница сбрасывается, когда меняются период или фильтры: вторая страница
  // «двоек» не имеет отношения ко второй странице всех отзывов.
  const pageKey = `${period}|${String(filters.rating)}|${String(filters.answered)}`
  const [paging, setPaging] = useState({ key: pageKey, offset: 0 })
  const offset = paging.key === pageKey ? paging.offset : 0
  const reviews = useReviews(period, filters, offset)

  const setFilters = (next: ReviewFilters): void => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        writeFilters(updated, next)
        return updated
      },
      { replace: true },
    )
  }

  const chip = (on: boolean): string =>
    on ? 'chip chip--good filter-chip' : 'chip chip--neutral filter-chip'

  return (
    <section className="page">
      <header className="page__head page__head--split">
        <div>
          <h1 className="page__title">{t('communication.title')}</h1>
          <p className="page__subtitle">{t('communication.subtitle')}</p>
        </div>

        {tab === 'reviews' ? (
          <div className="period" role="group" aria-label={t('overview.period.label')}>
            {PERIODS.map((option) => (
              <button
                className={`period__option ${option === period ? 'period__option--on' : ''}`}
                key={option}
                type="button"
                aria-pressed={option === period}
                onClick={() => {
                  setPeriod(option)
                }}
              >
                {t(PERIOD_LABEL[option])}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="tabs" role="tablist" aria-label={t('communication.tabs.label')}>
        {COMMUNICATION_TABS.map((option) => (
          <button
            key={option.value}
            className={option.value === tab ? 'tabs__tab tabs__tab--on' : 'tabs__tab'}
            type="button"
            role="tab"
            aria-selected={option.value === tab}
            onClick={() => {
              setParams(option.value === 'reviews' ? {} : { tab: option.value }, {
                replace: true,
              })
            }}
          >
            {t(option.label)}
          </button>
        ))}
      </div>

      {tab === 'news' ? (
        <NewsView />
      ) : tab === 'messages' ? (
        <MessagesView />
      ) : reviews.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : reviews.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{reviews.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void reviews.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <ReviewSummaryView summary={reviews.data.summary} />

          <div className="filter-chips" role="group" aria-label={t('reviews.filter.rating')}>
            {RATING_OPTIONS.map((rating) => (
              <button
                key={String(rating)}
                className={chip(filters.rating === rating)}
                type="button"
                aria-pressed={filters.rating === rating}
                onClick={() => {
                  setFilters({ ...filters, rating })
                }}
              >
                {rating === null ? t('reviews.filter.all') : `★ ${String(rating)}`}
              </button>
            ))}
          </div>

          <div className="filter-chips" role="group" aria-label={t('reviews.filter.answer')}>
            {ANSWERED_OPTIONS.map((option) => (
              <button
                key={String(option.value)}
                className={chip(filters.answered === option.value)}
                type="button"
                aria-pressed={filters.answered === option.value}
                onClick={() => {
                  setFilters({ ...filters, answered: option.value })
                }}
              >
                {t(option.label)}
              </button>
            ))}
          </div>

          {reviews.data.items.length === 0 ? (
            <div className="state">
              <p className="state__title">
                {t(
                  reviews.data.summary.total === 0
                    ? 'reviews.empty.title'
                    : 'reviews.empty.filtered',
                )}
              </p>
              <p className="state__hint">{t('reviews.empty.hint')}</p>
            </div>
          ) : (
            <div className="review-list">
              {reviews.data.items.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}

          {reviews.data.total > REVIEWS_PAGE ? (
            <div className="pager">
              <button
                className="button"
                type="button"
                disabled={offset === 0}
                onClick={() => {
                  setPaging({ key: pageKey, offset: Math.max(0, offset - REVIEWS_PAGE) })
                }}
              >
                {t('reviews.prev')}
              </button>
              <button
                className="button"
                type="button"
                disabled={offset + REVIEWS_PAGE >= reviews.data.total}
                onClick={() => {
                  setPaging({ key: pageKey, offset: offset + REVIEWS_PAGE })
                }}
              >
                {t('reviews.next')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
