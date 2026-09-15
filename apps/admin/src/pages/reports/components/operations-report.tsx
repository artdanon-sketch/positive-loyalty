import type { ReactElement } from 'react'
import type { DashboardPeriod } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useOperationsReport } from '../hooks'
import { DayBars } from './day-bars'
import { ReportState } from './report-state'

/**
 * Вкладка «Операции»: выручка, покупки, средний чек, баллы и отмены. docs/02, раздел 5.10.
 *
 * Выручка — деньгами: оплаченное баллами показано рядом, отдельной плиткой,
 * чтобы владелец видел, сколько программа стоит ему в баллах.
 */
export function OperationsReportView({ period }: { period: DashboardPeriod }): ReactElement {
  const t = useT()
  const report = useOperationsReport(period)

  return (
    <ReportState query={report}>
      {(data) => (
        <>
          <section className="tiles" aria-label={t('reports.tab.operations')}>
            <article className="tile">
              <h2 className="tile__label">{t('reports.operations.turnover')}</h2>
              <b className="tile__value">{formatBaht(data.turnover)}</b>
              <p className="tile__meta">
                <span className="tile__hint">{t('reports.operations.turnoverHint')}</span>
              </p>
            </article>
            <article className="tile">
              <h2 className="tile__label">{t('reports.operations.purchases')}</h2>
              <b className="tile__value">{data.purchases}</b>
              <p className="tile__meta">
                {data.averageCheck === null ? null : (
                  <span className="tile__hint">
                    {fill(t('reports.operations.averageCheck'), {
                      amount: formatBaht(data.averageCheck),
                    })}
                  </span>
                )}
                <span className="tile__hint">
                  {fill(t('reports.operations.voided'), { n: data.voided })}
                </span>
              </p>
            </article>
            <article className="tile">
              <h2 className="tile__label">{t('reports.operations.points')}</h2>
              <b className="tile__value">
                {fill(t('reports.operations.pointsValue'), {
                  earned: formatBaht(data.earned),
                  redeemed: formatBaht(data.redeemed),
                })}
              </b>
              <p className="tile__meta">
                <span className="tile__hint">{t('reports.operations.pointsHint')}</span>
              </p>
            </article>
          </section>

          <DayBars
            title={t('reports.operations.chart')}
            days={data.series.map((day) => ({ date: day.date, value: day.turnover }))}
            format={formatBaht}
          />
        </>
      )}
    </ReportState>
  )
}
