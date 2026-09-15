import type { ReactElement, ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { useT } from '../../../shared/i18n'

/**
 * Загрузка и ошибка отчёта — одинаково на всех вкладках.
 * Ошибка остаётся рядом с отчётом, с кнопкой «Повторить»: вкладки и период живы.
 */
export function ReportState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T, Error>
  children: (data: T) => ReactNode
}): ReactElement {
  const t = useT()

  if (query.isPending) {
    return (
      <p className="state__hint" role="status">
        {t('common.loading')}
      </p>
    )
  }

  if (query.isError) {
    return (
      <div role="alert">
        <p className="state__hint state__hint--error">{query.error.message}</p>
        <button
          className="button"
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

  return <>{children(query.data)}</>
}
