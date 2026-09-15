import { useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'
import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { PERIODS } from '../overview/hooks'
import { ChannelReportTable } from './components/channel-report-table'
import { useChannelReport } from './hooks'

/**
 * Экран «Отчёты» — `/reports`. docs/11, разделы 2 и 3 (У7, У8).
 *
 * Первым здесь отчёт «Источники»: откуда приходят гости и сколько приносят.
 * Клиенты, операции, RFM и сотрудники добавятся рядом отдельными блоками.
 *
 * Период по умолчанию — месяц, а не неделя, как в обзоре: табличка на столе
 * окупается не за семь дней, и недельная таблица почти всегда пустая.
 */

const PERIOD_LABEL: Readonly<Record<DashboardPeriod, TranslationKey>> = {
  '7d': 'overview.period.7d',
  '30d': 'overview.period.30d',
  '90d': 'overview.period.90d',
}

export function ReportsPage(): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const [period, setPeriod] = useState<DashboardPeriod>('30d')
  const report = useChannelReport(period)

  return (
    <section className="page">
      <header className="page__head page__head--split">
        <div>
          <h1 className="page__title">{t('reports.title')}</h1>
          <p className="page__subtitle">{t('reports.subtitle')}</p>
        </div>

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
      </header>

      <section className="panel" aria-labelledby="report-channels-title">
        <h2 className="panel__title" id="report-channels-title">
          {t('reports.channels.title')}
        </h2>
        <p className="field__hint">{t('reports.channels.hint')}</p>

        {report.isPending ? (
          <p className="state__hint" role="status">
            {t('common.loading')}
          </p>
        ) : report.isError ? (
          <div role="alert">
            <p className="state__hint state__hint--error">{report.error.message}</p>
            <button
              className="button"
              type="button"
              onClick={() => {
                void report.refetch()
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : report.data.channels.length === 0 ? (
          <div className="state">
            <p className="state__title">{t('reports.channels.empty.title')}</p>
            <p className="state__hint">
              {t(isOwner ? 'reports.channels.empty.owner' : 'reports.channels.empty.manager')}
            </p>
            {isOwner ? (
              <Link className="button button--primary" to="/settings">
                {t('reports.channels.toSettings')}
              </Link>
            ) : null}
          </div>
        ) : (
          <ChannelReportTable report={report.data} />
        )}
      </section>
    </section>
  )
}
