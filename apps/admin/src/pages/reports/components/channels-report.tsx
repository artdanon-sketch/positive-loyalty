import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { useAuth } from '../../../shared/auth/auth-context'
import { useT } from '../../../shared/i18n'
import { useChannelReport } from '../hooks'
import { ChannelReportTable } from './channel-report-table'
import { ReportState } from './report-state'

/**
 * Вкладка «Источники»: сколько гостей, покупателей и выручки принёс каждый источник.
 * docs/02, раздел 5.9 · docs/11, У7.
 *
 * Источников нет — владельцу подсказка и кнопка в настройки, менеджеру — кто их заводит.
 */
export function ChannelsReportView({ period }: { period: DashboardPeriod }): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const report = useChannelReport(period)

  return (
    <section className="panel" aria-labelledby="report-channels-title">
      <h2 className="panel__title" id="report-channels-title">
        {t('reports.channels.title')}
      </h2>
      <p className="field__hint">{t('reports.channels.hint')}</p>

      <ReportState query={report}>
        {(data) =>
          data.channels.length === 0 ? (
            <div className="state">
              <p className="state__title">{t('reports.channels.empty.title')}</p>
              <p className="state__hint">
                {t(isOwner ? 'reports.channels.empty.owner' : 'reports.channels.empty.manager')}
              </p>
              {isOwner ? (
                <Link className="button button--primary" to="/settings">
                  {t('reports.channels.toSettings')}
                </Link>
              ) : null}
            </div>
          ) : (
            <ChannelReportTable report={data} />
          )
        }
      </ReportState>
    </section>
  )
}
