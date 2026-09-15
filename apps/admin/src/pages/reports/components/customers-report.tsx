import type { ReactElement } from 'react'
import type { DashboardPeriod } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useLocale, useT } from '../../../shared/i18n'
import { useCustomersReport } from '../hooks'
import { DayBars } from './day-bars'
import { ReportState } from './report-state'

/**
 * Вкладка «Клиенты»: сколько гостей, сколько из них покупают, кто пришёл за период.
 * docs/02, раздел 5.10.
 */
export function CustomersReportView({ period }: { period: DashboardPeriod }): ReactElement {
  const t = useT()
  const locale = useLocale()
  const report = useCustomersReport(period)

  return (
    <ReportState query={report}>
      {(data) => (
        <>
          <section className="tiles" aria-label={t('reports.tab.customers')}>
            <article className="tile">
              <h2 className="tile__label">{t('reports.customers.total')}</h2>
              <b className="tile__value">{data.total}</b>
            </article>
            <article className="tile">
              <h2 className="tile__label">{t('reports.customers.buyers')}</h2>
              <b className="tile__value">{data.buyers}</b>
              {data.buyersPct === null ? null : (
                <p className="tile__meta">
                  <span className="tile__hint">
                    {fill(t('reports.customers.buyersPct'), {
                      pct: data.buyersPct.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US'),
                    })}
                  </span>
                </p>
              )}
            </article>
            <article className="tile">
              <h2 className="tile__label">{t('reports.customers.new')}</h2>
              <b className="tile__value">{data.newGuests}</b>
              <p className="tile__meta">
                <span className="tile__hint">
                  {fill(t('reports.customers.firstPurchases'), { n: data.firstPurchases })}
                </span>
              </p>
            </article>
            <article className="tile">
              <h2 className="tile__label">{t('reports.customers.mix')}</h2>
              <b className="tile__value">
                {fill(t('reports.customers.mixValue'), {
                  tourists: data.tourists,
                  residents: data.residents,
                })}
              </b>
            </article>
          </section>

          <DayBars
            title={t('reports.customers.chart')}
            days={data.series.map((day) => ({ date: day.date, value: day.newGuests }))}
            format={String}
          />
        </>
      )}
    </ReportState>
  )
}
