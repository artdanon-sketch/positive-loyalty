import type { ReactElement } from 'react'
import type { DashboardPeriod, StaffReportCounts, StaffReportRow } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useStaffReport } from '../hooks'
import { ReportState } from './report-state'

/**
 * Вкладка «Сотрудники»: чеки, выручка и новые гости по тому, кто провёл чек.
 * docs/02, раздел 5.10.
 *
 * Чеки из кассы POSitive — отдельной строкой: у них нет сотрудника в программе,
 * и без этой строки итог по сотрудникам не сошёлся бы с «Операциями».
 */

const ROLE_LABELS: Readonly<Record<StaffReportRow['role'], TranslationKey>> = {
  CASHIER: 'role.cashier',
  MANAGER: 'role.manager',
  OWNER: 'role.owner',
}

/**
 * Оценка — со числом отзывов: «5,0» по одному отзыву и «4,8» по сорока выглядят
 * одинаково, а значат разное. Отзывов нет — прочерк, а не ноль: ноль звёзд не бывает.
 */
const ratingCell = (row: StaffReportCounts, translate: (key: TranslationKey) => string): string =>
  row.rating === null
    ? '—'
    : fill(translate('reports.staff.rating'), { rating: row.rating.toFixed(1), n: row.reviews })

export function StaffReportView({ period }: { period: DashboardPeriod }): ReactElement {
  const t = useT()
  const report = useStaffReport(period)

  return (
    <ReportState query={report}>
      {(data) =>
        data.staff.length === 0 && data.system.operations === 0 ? (
          <div className="state">
            <p className="state__hint">{t('reports.staff.empty')}</p>
          </div>
        ) : (
          <section className="panel" aria-labelledby="report-staff-title">
            <h2 className="panel__title" id="report-staff-title">
              {t('reports.tab.staff')}
            </h2>
            <p className="field__hint">{t('reports.staff.hint')}</p>

            <div className="table-scroll">
              <table className="data-table" aria-labelledby="report-staff-title">
                <thead>
                  <tr>
                    <th>{t('reports.staff.col.name')}</th>
                    <th>{t('reports.staff.col.role')}</th>
                    <th className="data-table__num">{t('reports.staff.col.operations')}</th>
                    <th className="data-table__num">{t('reports.staff.col.turnover')}</th>
                    <th className="data-table__num">{t('reports.staff.col.newGuests')}</th>
                    <th className="data-table__num">{t('reports.staff.col.rating')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((row) => (
                    <tr
                      key={row.staffId}
                      className={row.isActive ? undefined : 'data-table__row--muted'}
                    >
                      <td>{row.displayName}</td>
                      <td>{t(ROLE_LABELS[row.role])}</td>
                      <td className="data-table__num">{row.operations}</td>
                      <td className="data-table__num">{formatBaht(row.turnover)}</td>
                      <td className="data-table__num">{row.newGuests}</td>
                      <td className="data-table__num">{ratingCell(row, t)}</td>
                    </tr>
                  ))}
                  {data.system.operations === 0 ? null : (
                    <tr className="report-row--rest">
                      <td>{t('reports.staff.system')}</td>
                      <td />
                      <td className="data-table__num">{data.system.operations}</td>
                      <td className="data-table__num">{formatBaht(data.system.turnover)}</td>
                      <td className="data-table__num">{data.system.newGuests}</td>
                      <td className="data-table__num">{ratingCell(data.system, t)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )
      }
    </ReportState>
  )
}
