import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { formatBaht, formatDate } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useTopGuestsReport } from '../hooks'
import { ReportState } from './report-state'

/**
 * Вкладка «Лучшие гости»: двадцать гостей, принёсших больше всего денег за период.
 * docs/02, раздел 5.10.
 *
 * Имя ведёт в карточку гостя: рейтинг нужен, чтобы что-то сделать с этими людьми —
 * подарить, поднять статус, позвонить. Рейтинг за всё время — список гостей
 * с порядком «больше потратили», ссылка на него под таблицей.
 */
export function TopGuestsReportView({ period }: { period: DashboardPeriod }): ReactElement {
  const t = useT()
  const report = useTopGuestsReport(period)

  return (
    <ReportState query={report}>
      {(data) =>
        data.guests.length === 0 ? (
          <div className="state">
            <p className="state__hint">{t('reports.top.empty')}</p>
          </div>
        ) : (
          <section className="panel" aria-labelledby="report-top-title">
            <h2 className="panel__title" id="report-top-title">
              {t('reports.tab.top')}
            </h2>
            <p className="field__hint">{t('reports.top.hint')}</p>

            <div className="table-scroll">
              <table className="data-table" aria-labelledby="report-top-title">
                <thead>
                  <tr>
                    <th className="data-table__num">{t('reports.top.col.rank')}</th>
                    <th>{t('reports.top.col.guest')}</th>
                    <th>{t('reports.top.col.tier')}</th>
                    <th className="data-table__num">{t('reports.top.col.purchases')}</th>
                    <th className="data-table__num">{t('reports.top.col.turnover')}</th>
                    <th className="data-table__num">{t('reports.top.col.points')}</th>
                    <th className="data-table__num">{t('reports.top.col.lastVisit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.guests.map((row) => (
                    <tr key={row.membershipId}>
                      <td className="data-table__num">{row.rank}</td>
                      <td>
                        <Link
                          className="link-button"
                          to={`/guests?guest=${encodeURIComponent(row.guestId)}`}
                        >
                          {row.displayName ?? row.phone ?? t('guests.noName')}
                        </Link>
                      </td>
                      <td>{row.tier?.name ?? '—'}</td>
                      <td className="data-table__num">{row.purchases}</td>
                      <td className="data-table__num">{formatBaht(row.turnover)}</td>
                      <td className="data-table__num">{formatBaht(row.pointsBalance)}</td>
                      <td className="data-table__num">{formatDate(row.lastVisitAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="field__hint">
              <Link className="link-button" to="/guests?sort=spent">
                {t('reports.top.allTime')}
              </Link>
            </p>
          </section>
        )
      }
    </ReportState>
  )
}
