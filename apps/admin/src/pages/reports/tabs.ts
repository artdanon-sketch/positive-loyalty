import type { TranslationKey } from '../../shared/i18n'

/**
 * Вкладки раздела «Отчёты». docs/11, раздел 2 · У7, У8.
 *
 * Вкладка живёт в адресе (`/reports?tab=rfm`): ссылку «посмотри RFM» можно
 * переслать управляющему, а возврат из списка гостей приводит туда же, откуда ушли.
 * Неизвестная вкладка в адресе — «Клиенты», а не пустой экран.
 */

export const REPORT_TABS = ['customers', 'operations', 'rfm', 'staff', 'channels'] as const

export type ReportTab = (typeof REPORT_TABS)[number]

export const DEFAULT_REPORT_TAB: ReportTab = 'customers'

export const TAB_LABELS: Readonly<Record<ReportTab, TranslationKey>> = {
  customers: 'reports.tab.customers',
  operations: 'reports.tab.operations',
  rfm: 'reports.tab.rfm',
  staff: 'reports.tab.staff',
  channels: 'reports.tab.channels',
}

export const tabFromParams = (params: URLSearchParams): ReportTab =>
  REPORT_TABS.find((tab) => tab === params.get('tab')) ?? DEFAULT_REPORT_TAB
