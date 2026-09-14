import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { useT } from '../../../shared/i18n'
import { usePartnerships } from '../hooks'
import { STATUS_LABELS, STATUS_TONES } from '../labels'

/**
 * Свои партнёрства. Порядок задаёт сервер: сначала ждущие нашего ответа,
 * в конце — завершённые. Приглашение, которое ждёт ответа, помечено отдельно:
 * это единственная строка списка, которая требует действия сейчас.
 */
export function PartnershipList({ onFind }: { onFind: () => void }): ReactElement {
  const t = useT()
  const list = usePartnerships()

  if (list.isPending) {
    return (
      <div className="state" role="status">
        <p className="state__title">{t('common.loading')}</p>
      </div>
    )
  }

  if (list.isError) {
    return (
      <div className="state state--error" role="alert">
        <p className="state__title">{t('common.error.title')}</p>
        <p className="state__hint">{list.error.message}</p>
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            void list.refetch()
          }}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (list.data.items.length === 0) {
    return (
      <div className="state">
        <p className="state__title">{t('partners.empty.title')}</p>
        <p className="state__hint">{t('partners.empty.hint')}</p>
        <button className="button button--primary" type="button" onClick={onFind}>
          {t('partners.empty.action')}
        </button>
      </div>
    )
  }

  return (
    <ul className="partner-list">
      {list.data.items.map((item) => (
        <li key={item.id}>
          <Link className="partner-row" to={`/partners/${item.id}`}>
            <span className="partner-row__name">
              {item.partner.brandName ?? t('partner.fallbackName')}
            </span>
            <span className="partner-row__meta">
              <span className={`chip ${STATUS_TONES[item.status]}`}>
                {t(STATUS_LABELS[item.status])}
              </span>
              {item.status === 'PROPOSED' ? (
                <span
                  className={`chip ${item.direction === 'INCOMING' ? 'chip--good' : 'chip--muted'}`}
                >
                  {t(item.direction === 'INCOMING' ? 'partners.waitingUs' : 'partners.waitingThem')}
                </span>
              ) : null}
            </span>
            <span className="partner-row__terms">
              {t('partners.terms.weGive')}: {item.activeTerms.weGive} ·{' '}
              {t('partners.terms.theyGive')}: {item.activeTerms.theyGive}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
