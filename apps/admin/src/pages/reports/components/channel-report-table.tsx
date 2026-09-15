import type { ReactElement } from 'react'
import type { ChannelReport } from '@positive/contracts'

import { formatBaht } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'

/**
 * Таблица «Источники»: вступили, впервые купили и выручка. docs/02, раздел 5.9.
 *
 * Последней строкой — гости без источника. Без неё табличка на столе с двадцатью
 * гостями выглядит главным каналом, даже если шестьдесят пришли сами.
 * Выключенный источник остаётся в таблице: его прошлые гости никуда не делись.
 */
export function ChannelReportTable({ report }: { report: ChannelReport }): ReactElement {
  const t = useT()

  return (
    <div className="table-scroll">
      <table className="data-table" aria-labelledby="report-channels-title">
        <thead>
          <tr>
            <th>{t('reports.channels.col.name')}</th>
            <th className="data-table__num">{t('reports.channels.col.guests')}</th>
            <th className="data-table__num">{t('reports.channels.col.buyers')}</th>
            <th className="data-table__num">{t('reports.channels.col.revenue')}</th>
          </tr>
        </thead>
        <tbody>
          {report.channels.map((row) => (
            <tr key={row.channelId} className={row.isActive ? undefined : 'data-table__row--muted'}>
              <td>
                {row.name}
                {row.isActive ? null : (
                  <>
                    {' '}
                    <span className="chip chip--muted">{t('reports.channels.off')}</span>
                  </>
                )}
              </td>
              <td className="data-table__num">{row.guests}</td>
              <td className="data-table__num">{row.buyers}</td>
              <td className="data-table__num">{formatBaht(row.revenue)}</td>
            </tr>
          ))}
          <tr className="report-row--rest">
            <td>{t('reports.channels.unattributed')}</td>
            <td className="data-table__num">{report.unattributed.guests}</td>
            <td className="data-table__num">{report.unattributed.buyers}</td>
            <td className="data-table__num">{formatBaht(report.unattributed.revenue)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
