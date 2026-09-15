import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { fill } from '../../../shared/format/fill'
import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { RFM_HINTS, RFM_LABELS } from '../../../shared/rfm/labels'
import { useRfmReport } from '../hooks'
import { ReportState } from './report-state'

/**
 * Вкладка «RFM»: десять сегментов покупателей на сегодня. docs/02, раздел 5.10.
 *
 * СЕГМЕНТ КЛИКАЕТСЯ. Цифра «в зоне риска — 26» полезна только тогда, когда за ней
 * сразу видны эти 26 человек: название сегмента ведёт в «Гости» с этим фильтром.
 * Пустой сегмент — не ссылка: вести в пустой список незачем.
 */
export function RfmReportView(): ReactElement {
  const t = useT()
  const report = useRfmReport()

  return (
    <ReportState query={report}>
      {(data) =>
        data.buyers === 0 ? (
          <div className="state">
            <p className="state__hint">{t('reports.rfm.empty')}</p>
          </div>
        ) : (
          <section className="panel" aria-labelledby="report-rfm-title">
            <h2 className="panel__title" id="report-rfm-title">
              {t('reports.tab.rfm')}
            </h2>
            <p className="field__hint">
              {t('reports.rfm.hint')} {fill(t('reports.rfm.buyers'), { n: data.buyers })}
            </p>

            <div className="table-scroll">
              <table className="data-table" aria-labelledby="report-rfm-title">
                <thead>
                  <tr>
                    <th>{t('reports.rfm.col.segment')}</th>
                    <th className="data-table__num">{t('reports.rfm.col.guests')}</th>
                    <th className="data-table__num">{t('reports.rfm.col.purchases')}</th>
                    <th className="data-table__num">{t('reports.rfm.col.averageCheck')}</th>
                    <th className="data-table__num">{t('reports.rfm.col.turnover')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.segments.map((row) => (
                    <tr
                      key={row.segment}
                      className={row.guests === 0 ? 'data-table__row--muted' : undefined}
                    >
                      <td>
                        {row.guests === 0 ? (
                          <b>{t(RFM_LABELS[row.segment])}</b>
                        ) : (
                          <Link
                            className="link-button"
                            to={`/guests?segment=${encodeURIComponent(row.segment)}`}
                          >
                            {t(RFM_LABELS[row.segment])}
                          </Link>
                        )}
                        <span className="data-table__sub">{t(RFM_HINTS[row.segment])}</span>
                      </td>
                      <td className="data-table__num">{row.guests}</td>
                      <td className="data-table__num">{row.purchases}</td>
                      <td className="data-table__num">
                        {row.averageCheck === null ? '—' : formatBaht(row.averageCheck)}
                      </td>
                      <td className="data-table__num">{formatBaht(row.turnover)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      }
    </ReportState>
  )
}
