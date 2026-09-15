import type { ReactElement } from 'react'
import type { ReviewsSummary } from '@positive/contracts'

import { useLocale, useT } from '../../../shared/i18n'
import { TAG_LABELS } from '../tag-labels'

/**
 * Сводка отзывов за период: средняя, сколько всего, сколько ждут ответа,
 * распределение по звёздам и быстрые отзывы по темам. docs/03 · docs/11, У10.
 *
 * Сводка не зависит от фильтров списка: открыв «ждут ответа», владелец видит рядом
 * общую картину.
 */

const RATINGS = [5, 4, 3, 2, 1] as const

export function ReviewSummaryView({ summary }: { summary: ReviewsSummary }): ReactElement {
  const t = useT()
  const locale = useLocale()
  const busiest = Math.max(1, ...summary.distribution)

  return (
    <>
      <section className="tiles" aria-label={t('reviews.summary')}>
        <article className="tile">
          <h2 className="tile__label">{t('reviews.average')}</h2>
          <b className="tile__value">
            {summary.average === null
              ? '—'
              : summary.average.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
          </b>
        </article>
        <article className="tile">
          <h2 className="tile__label">{t('reviews.total')}</h2>
          <b className="tile__value">{summary.total}</b>
        </article>
        <article className="tile">
          <h2 className="tile__label">{t('reviews.unanswered')}</h2>
          <b className="tile__value">{summary.unanswered}</b>
        </article>
      </section>

      <div className="review-overview">
        <section className="panel" aria-labelledby="reviews-distribution-title">
          <h2 className="panel__title" id="reviews-distribution-title">
            {t('reviews.distribution')}
          </h2>
          <ul className="review-bars">
            {RATINGS.map((rating) => {
              const count = summary.distribution[rating - 1] ?? 0

              return (
                <li className="review-bars__row" key={rating}>
                  <span className="review-bars__label">{`★ ${String(rating)}`}</span>
                  <span className="review-bars__track" aria-hidden="true">
                    <span
                      className="review-bars__fill"
                      style={{ width: `${String(Math.round((count / busiest) * 100))}%` }}
                    />
                  </span>
                  <span className="review-bars__count">{count}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="panel" aria-labelledby="reviews-tags-title">
          <h2 className="panel__title" id="reviews-tags-title">
            {t('reviews.tags')}
          </h2>
          <ul className="review-tags">
            {summary.tags.map((entry) => (
              <li className="review-tags__row" key={entry.tag}>
                <span>{t(TAG_LABELS[entry.tag])}</span>
                <b className="review-tags__count">{entry.count}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
