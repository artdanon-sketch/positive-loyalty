import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'

/**
 * Сводка экрана «Обзор».
 *
 * По ТЗ данные приходят из `GET /v1/admin/dashboard?period=7d`
 * (docs/03_Бэк-офис_экраны.md, раздел 2). В задаче 1 эндпоинта ещё нет,
 * поэтому источник честно отдаёт пустую сводку: ветки «загрузка», «пусто»
 * и «ошибка» на экране настоящие и переключаются состоянием запроса,
 * а не флагом для демонстрации.
 */
export interface OverviewSummary {
  /** Есть ли за период хоть один оформленный гость. */
  readonly hasData: boolean
}

export const OVERVIEW_QUERY_KEY = ['admin', 'overview'] as const

// Не `async`: ждать здесь нечего, а пустой `async` обещает асинхронность,
// которой нет. Когда появится GET /v1/admin/dashboard, здесь будет настоящий fetch.
function fetchOverview(): Promise<OverviewSummary> {
  return Promise.resolve({ hasData: false })
}

export function useOverview(): UseQueryResult<OverviewSummary, Error> {
  return useQuery({ queryKey: OVERVIEW_QUERY_KEY, queryFn: fetchOverview })
}
