import type { ReactElement } from 'react'

import { useAuth } from '../../../shared/auth/auth-context'
import { isCashierApp } from '../../../shared/config/product'
import { fill } from '../../../shared/format/fill'
import { formatBaht, formatDateTime } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useStuckReceipts } from '../use-stuck-receipts'

/**
 * «Чеки, которые не дошли» — на экране кассы у владельца и менеджера.
 * docs/10, раздел 5.7.
 *
 * Пустой список — блока нет вовсе: «всё дошло» не новость, а норма.
 *
 * У каждого чека — кто и на каком планшете, почему не дошёл и когда планшет
 * последний раз выходил на связь. Этого хватает, чтобы понять, что делать:
 * «нет связи» — дождаться или перезагрузить роутер у бара; «сервер отказал» —
 * провести чек заново, иначе гость так и останется без баллов.
 */
export function StuckReceipts(): ReactElement | null {
  const t = useT()
  const role = useAuth().session?.subject.role
  const allowed = (role === 'MANAGER' || role === 'OWNER') && !isCashierApp()
  const list = useStuckReceipts(allowed)

  if (!allowed || !list.isSuccess || list.data.items.length === 0) {
    return null
  }

  return (
    <section className="panel stuck" aria-labelledby="stuck-title">
      <h2 className="panel__title" id="stuck-title">
        {t('stuck.title')}
      </h2>
      <p className="state__hint">{t('stuck.hint')}</p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('stuck.col.when')}</th>
              <th className="data-table__num">{t('stuck.col.amount')}</th>
              <th>{t('stuck.col.guest')}</th>
              <th>{t('stuck.col.who')}</th>
              <th>{t('stuck.col.why')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((item) => (
              <tr key={item.receiptId}>
                <td>{formatDateTime(item.queuedAt)}</td>
                <td className="data-table__num">{formatBaht(item.amount)}</td>
                <td>{item.guest ?? '—'}</td>
                <td>
                  {item.staffName ?? '—'}
                  <span className="data-table__sub">
                    {fill(t('stuck.terminal'), { id: item.terminal })}
                  </span>
                </td>
                <td className="stuck__why">
                  {item.stuck ? (item.lastError ?? t('stuck.rejected')) : t('stuck.late')}
                  <span className="data-table__sub">
                    {fill(t('stuck.lastSeen'), { when: formatDateTime(item.reportedAt) })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
