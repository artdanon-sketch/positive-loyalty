import { useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { useT } from '../../shared/i18n'
import type { TranslationKey } from '../../shared/i18n'
import { PERIODS } from '../overview/hooks'
import { HistoryView } from './components/history-view'
import { SuspiciousView } from './components/suspicious-view'

/**
 * Экран «Безопасность» — `/settings/security`. docs/03, раздел 9 · docs/11, У12.
 *
 * Из настроек, а не пунктом меню: это разбор, к которому возвращаются по поводу,
 * а не рабочий экран дня (решение владельца — меню не раздуваем). Только владелец:
 * запрет стоит на сервере, менеджер по прямой ссылке увидит отказ.
 *
 * Вкладка живёт в адресе (`?tab=history`), период — только у «Подозрительного».
 */

type SecurityTab = 'suspicious' | 'history'

const PERIOD_LABEL: Readonly<Record<DashboardPeriod, TranslationKey>> = {
  '7d': 'overview.period.7d',
  '30d': 'overview.period.30d',
  '90d': 'overview.period.90d',
}

const TABS: ReadonlyArray<{ value: SecurityTab; label: TranslationKey }> = [
  { value: 'suspicious', label: 'security.tab.suspicious' },
  { value: 'history', label: 'security.tab.history' },
]

export function SecurityPage(): ReactElement {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const tab: SecurityTab = params.get('tab') === 'history' ? 'history' : 'suspicious'
  const [period, setPeriod] = useState<DashboardPeriod>('7d')

  return (
    <section className="page">
      <header className="page__head page__head--split">
        <div>
          <Link className="link-button" to="/settings">
            {t('security.back')}
          </Link>
          <h1 className="page__title">{t('security.title')}</h1>
          <p className="page__subtitle">{t('security.subtitle')}</p>
        </div>

        {tab === 'history' ? null : (
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

      <div className="tabs" role="tablist" aria-label={t('security.tabs.label')}>
        {TABS.map((option) => (
          <button
            key={option.value}
            className={option.value === tab ? 'tabs__tab tabs__tab--on' : 'tabs__tab'}
            type="button"
            role="tab"
            aria-selected={option.value === tab}
            onClick={() => {
              setParams(option.value === 'suspicious' ? {} : { tab: 'history' }, { replace: true })
            }}
          >
            {t(option.label)}
          </button>
        ))}
      </div>

      {tab === 'history' ? <HistoryView /> : <SuspiciousView period={period} />}
    </section>
  )
}
