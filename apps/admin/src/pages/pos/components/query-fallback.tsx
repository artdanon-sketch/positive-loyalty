import type { ReactElement } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { useT } from '../../../shared/i18n'

/**
 * Что показать вкладке кассы, пока данных нет: загрузку или ошибку с повтором.
 *
 * Одна на три вкладки: у кассира в очереди нет времени разбираться, почему
 * «Пригласить» и «История» сообщают о сбое по-разному.
 */
export function QueryFallback({ query }: { query: UseQueryResult<unknown, Error> }): ReactElement {
  const t = useT()

  if (query.isError) {
    return (
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
    )
  }

  return (
    <div className="state" role="status">
      <p className="state__title">{t('common.loading')}</p>
    </div>
  )
}
