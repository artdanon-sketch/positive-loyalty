import { useState } from 'react'
import type { ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { PERIODS } from '../overview/hooks'
import { ChannelsReportView } from './components/channels-report'
import { CustomersReportView } from './components/customers-report'
import { OperationsReportView } from './components/operations-report'
import { RfmReportView } from './components/rfm-report'
import { StaffReportView } from './components/staff-report'
import { DEFAULT_REPORT_TAB, REPORT_TABS, TAB_LABELS, tabFromParams } from './tabs'
import type { ReportTab } from './tabs'

/**
 * Экран «Отчёты» — `/reports`. docs/11, раздел 2 · У7, У8.
 *
 * Вкладками внутри одного раздела, а не пунктами меню: у UDS это пять экранов,
 * у нас одна строка вкладок (решение владельца — функции берём, меню не раздуваем).
 *
 * Период общий для вкладок: владелец сравнивает «Операции» и «Сотрудников» за один
 * и тот же месяц. У RFM периода нет — сегмент и есть срез «сейчас», и переключатель
 * там прячется, чтобы не обещать того, чего нет.
 *
 * Период по умолчанию — месяц, а не неделя, как в обзоре: у малого заведения
 * недельные отчёты почти всегда шумные.
 */

const PERIOD_LABEL: Readonly<Record<DashboardPeriod, TranslationKey>> = {
  '7d': 'overview.period.7d',
  '30d': 'overview.period.30d',
  '90d': 'overview.period.90d',
}

export function ReportsPage(): ReactElement {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const tab = tabFromParams(params)
  const [period, setPeriod] = useState<DashboardPeriod>('30d')

  const open = (next: ReportTab): void => {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)

        if (next === DEFAULT_REPORT_TAB) {
          updated.delete('tab')
        } else {
          updated.set('tab', next)
        }

        return updated
      },
      { replace: true },
    )
  }

  return (
    <section className="page">
      <header className="page__head page__head--split">
        <div>
          <h1 className="page__title">{t('reports.title')}</h1>
          <p className="page__subtitle">{t('reports.subtitle')}</p>
        </div>

        {tab === 'rfm' ? null : (
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
        )}
      </header>

      <div className="tabs" role="tablist" aria-label={t('reports.tabs.label')}>
        {REPORT_TABS.map((option) => (
          <button
            key={option}
            className={option === tab ? 'tabs__tab tabs__tab--on' : 'tabs__tab'}
            type="button"
            role="tab"
            aria-selected={option === tab}
            onClick={() => {
              open(option)
            }}
          >
            {t(TAB_LABELS[option])}
          </button>
        ))}
      </div>

      {tab === 'customers' ? (
        <CustomersReportView period={period} />
      ) : tab === 'operations' ? (
        <OperationsReportView period={period} />
      ) : tab === 'rfm' ? (
        <RfmReportView />
      ) : tab === 'staff' ? (
        <StaffReportView period={period} />
      ) : (
        <ChannelsReportView period={period} />
      )}
    </section>
  )
}
