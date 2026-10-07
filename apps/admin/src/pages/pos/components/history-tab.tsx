import { useState } from 'react'
import type { ReactElement } from 'react'

import { formatBaht, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { usePosHistory } from '../hooks'
import { QueryFallback } from './query-fallback'

/**
 * Вкладка «История»: свои чеки за период с итогом внизу, как у UDS.
 * docs/02, раздел 3.9.
 *
 * ИТОГ ПРИХОДИТ С СЕРВЕРА, А НЕ СКЛАДЫВАЕТСЯ ЗДЕСЬ. В списке не больше 200
 * чеков, а за месяц у занятого кассира их больше; сумма видимых строк
 * занизила бы выручку. По той же причине отменённый чек остаётся в списке
 * с пометкой, но в итог не входит — так считает сервер, так считают отчёты.
 */

const PERIODS = ['today', 'week', 'month'] as const

type Period = (typeof PERIODS)[number]

const PERIOD_LABEL: Readonly<Record<Period, TranslationKey>> = {
  today: 'pos.history.today',
  week: 'pos.history.week',
  month: 'pos.history.month',
}

export function HistoryTab(): ReactElement {
  const t = useT()
  const [period, setPeriod] = useState<Period>('today')
  const history = usePosHistory(period)

  const body = (): ReactElement => {
    if (history.data === undefined) {
      return <QueryFallback query={history} />
    }

    const { items, total, count, hasMore } = history.data

    if (items.length === 0) {
      return (
        <div className="state">
          <p className="state__title">{t('pos.history.empty')}</p>
        </div>
      )
    }

    return (
      <>
        <dl className="pos__summary">
          <div className="pos__row pos__row--accent">
            <dt>{t('pos.history.total')}</dt>
            <dd>{formatBaht(total)}</dd>
          </div>
          <div className="pos__row">
            <dt>{t('pos.history.count')}</dt>
            <dd>{count}</dd>
          </div>
        </dl>

        <ul className="pos-history" aria-label={t('pos.history.list')}>
          {items.map((item) => (
            <li
              key={item.id}
              className={
                item.reversed ? 'pos-history__item pos-history__item--void' : 'pos-history__item'
              }
            >
              <span className="pos-history__when">{formatDateTime(item.occurredAt)}</span>
              <span className="pos-history__guest">{item.guest ?? t('pos.history.noName')}</span>
              <span className="pos-history__amount">{formatBaht(item.amount)}</span>
              {item.reversed ? (
                <span className="chip chip--muted">{t('pos.history.voided')}</span>
              ) : (
                <span className="pos-history__points">+{formatBaht(item.points)}</span>
              )}
            </li>
          ))}
        </ul>

        {hasMore ? <p className="pos__hint">{t('pos.history.more')}</p> : null}
      </>
    )
  }

  return (
    <div className="pos__step">
      <div className="period" role="group" aria-label={t('pos.history.period')}>
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

      {body()}
    </div>
  )
}
