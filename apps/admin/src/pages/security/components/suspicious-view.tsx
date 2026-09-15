import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardPeriod } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import { useSuspicious } from '../hooks'
import { dayLabel, SIGNAL_LABELS } from '../labels'

/**
 * Вкладка «Подозрительное». docs/03, раздел 9 · docs/05, раздел 6.1 · docs/11, У12.
 *
 * Два списка: гости с частыми чеками и сотрудники — чек на свой номер и всплески.
 * Ничего не блокируется: это повод посмотреть, и экран так и говорит.
 */
export function SuspiciousView({ period }: { period: DashboardPeriod }): ReactElement {
  const t = useT()
  const report = useSuspicious(period)

  if (report.isPending) {
    return (
      <p className="state__hint" role="status">
        {t('common.loading')}
      </p>
    )
  }

  if (report.isError) {
    return (
      <div role="alert">
        <p className="state__hint state__hint--error">{report.error.message}</p>
        <button
          className="button"
          type="button"
          onClick={() => {
            void report.refetch()
          }}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  const data = report.data

  return (
    <>
      <section className="panel" aria-labelledby="suspicious-cashiers-title">
        <h2 className="panel__title" id="suspicious-cashiers-title">
          {t('security.cashiers.title')}
        </h2>
        <p className="field__hint">{t('security.cashiers.hint')}</p>
        {data.cashiers.length === 0 ? (
          <p className="state__hint">{t('security.cashiers.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-labelledby="suspicious-cashiers-title">
              <thead>
                <tr>
                  <th>{t('security.col.staff')}</th>
                  <th>{t('security.col.signal')}</th>
                  <th>{t('security.col.day')}</th>
                  <th className="data-table__num">{t('security.col.receipts')}</th>
                  <th className="data-table__num">{t('security.col.usual')}</th>
                </tr>
              </thead>
              <tbody>
                {data.cashiers.map((row) => (
                  <tr key={`${row.staffId}-${row.signal}-${row.day}`}>
                    <td>{row.displayName}</td>
                    <td>{t(SIGNAL_LABELS[row.signal])}</td>
                    <td>{dayLabel(row.day)}</td>
                    <td className="data-table__num">{row.receipts}</td>
                    <td className="data-table__num">{row.usual ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="suspicious-guests-title">
        <h2 className="panel__title" id="suspicious-guests-title">
          {t('security.guests.title')}
        </h2>
        <p className="field__hint">
          {fill(t('security.guests.hint'), { n: data.maxChecksPerDay })}
        </p>
        {data.guests.length === 0 ? (
          <p className="state__hint">{t('security.guests.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-labelledby="suspicious-guests-title">
              <thead>
                <tr>
                  <th>{t('security.col.guest')}</th>
                  <th>{t('security.col.phone')}</th>
                  <th>{t('security.col.day')}</th>
                  <th className="data-table__num">{t('security.col.receipts')}</th>
                </tr>
              </thead>
              <tbody>
                {data.guests.map((row) => (
                  <tr key={`${row.membershipId}-${row.day}`}>
                    <td>
                      <Link to={`/guests?guest=${row.guestId}`}>
                        {row.displayName ?? t('guests.noName')}
                      </Link>
                    </td>
                    <td className="data-table__mono">{row.phone ?? '—'}</td>
                    <td>{dayLabel(row.day)}</td>
                    <td className="data-table__num">{row.receipts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
