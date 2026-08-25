import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n'
import { EmptyState } from './components/empty-state'
import { ErrorState } from './components/error-state'
import { LoadingState } from './components/loading-state'
import { useOverview } from './hooks'

/**
 * Экран «Обзор» — `/` (docs/03_Бэк-офис_экраны.md, раздел 2).
 *
 * Заглушка задачи 1: три плитки, график по дням, живая лента и блок советов
 * появятся вместе с `GET /v1/admin/dashboard`. Сейчас на экране честно
 * отрабатывают три состояния из Definition of Done.
 */
export function OverviewPage(): ReactElement {
  const t = useT()
  const overview = useOverview()

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">{t('overview.title')}</h1>
        <p className="page__subtitle">{t('overview.subtitle')}</p>
      </header>

      {overview.isPending ? (
        <LoadingState />
      ) : overview.isError ? (
        <ErrorState
          onRetry={() => {
            void overview.refetch()
          }}
        />
      ) : (
        // Ветка «данные есть» появится вместе с GET /v1/admin/dashboard:
        // пока сводка всегда пустая, и это не заглушка, а настоящее состояние.
        <EmptyState />
      )}
    </section>
  )
}
