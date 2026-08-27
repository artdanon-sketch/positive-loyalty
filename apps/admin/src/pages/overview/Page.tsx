import { useState } from 'react'
import type { ReactElement } from 'react'
import type { DashboardPeriod } from '@positive/contracts'

import { useT } from '../../shared/i18n'
import { AdviceList } from './components/advice-list'
import { DaysChart } from './components/days-chart'
import { EmptyState } from './components/empty-state'
import { ErrorState } from './components/error-state'
import { HoursChart } from './components/hours-chart'
import { LiveFeed } from './components/live-feed'
import { LoadingState } from './components/loading-state'
import { StatTiles } from './components/stat-tiles'
import { PERIODS, useDashboard } from './hooks'
import { useLiveFeed } from './use-live-feed'

/**
 * Экран «Обзор» — `/` (docs/03, раздел 2).
 *
 * «Владелец заходит на две минуты. Он должен получить ответ на три вопроса
 * и один конкретный совет, что сделать сегодня.» Отсюда и порядок блоков:
 * сначала плитки с ответами, сразу за ними — советы, и только потом графики,
 * которые объясняют, откуда взялись и то, и другое.
 *
 * Живая лента идёт выше графиков: она отвечает на вопрос «что происходит
 * прямо сейчас», а графики — на «что происходило».
 */
export function OverviewPage(): ReactElement {
  const t = useT()
  const [period, setPeriod] = useState<DashboardPeriod>('7d')
  const query = useDashboard(period)
  // Поток открывается только когда есть что показывать рядом: на заведении
  // первого дня лента висела бы пустой над онбординг-чеклистом и мешала.
  const feed = useLiveFeed(query.data !== undefined && !query.data.isEmpty)

  return (
    <section className="page">
      <header className="page__head page__head--split">
        <div>
          <h1 className="page__title">{t('overview.title')}</h1>
          <p className="page__subtitle">{t('overview.subtitle')}</p>
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

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : query.data.isEmpty ? (
        // Первый день заведения: вместо плиток — онбординг-чеклист.
        <EmptyState />
      ) : (
        <>
          <StatTiles data={query.data} />
          <AdviceList advice={query.data.advice} />
          {/* Лента выше графиков: она отвечает на вопрос «что происходит
              прямо сейчас», а графики — на «что происходило». */}
          <LiveFeed events={feed.events} isConnected={feed.isConnected} />
          <DaysChart days={query.data.series} isPartial={query.data.isPartialPeriod} />
          <HoursChart hourly={query.data.hourly} advice={query.data.advice} />
        </>
      )}
    </section>
  )
}

/** Подписи периодов — ключами словаря, а не текстом в разметке. */
const PERIOD_LABEL = {
  '7d': 'overview.period.7d',
  '30d': 'overview.period.30d',
  '90d': 'overview.period.90d',
} as const
