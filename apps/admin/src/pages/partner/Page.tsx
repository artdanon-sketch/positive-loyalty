import type { ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '../../shared/auth/auth-context'
import { useT } from '../../shared/i18n'
import { PartnerChat } from './components/partner-chat'
import { PartnerHeader } from './components/partner-header'
import { PartnerTerms } from './components/partner-terms'
import { usePartnership } from './hooks'

/**
 * Одно партнёрство: кто, в каком статусе, условия в обе стороны и переписка.
 * docs/07, раздел 10 · docs/10, раздел 5.4.
 *
 * Кнопки показываются по списку `actions`, который прислал сервер, — экран
 * не пересказывает правила «кто может принять» своими словами. Менеджеру
 * кнопок нет вовсе: договариваться может только владелец.
 */
export function PartnerPage(): ReactElement {
  const t = useT()
  const { id = '' } = useParams()
  const detail = usePartnership(id)
  const isOwner = useAuth().session?.subject.role === 'OWNER'

  return (
    <section className="page">
      <Link className="back-link" to="/partners">
        ← {t('partner.back')}
      </Link>

      {detail.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : detail.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{detail.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void detail.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <PartnerHeader detail={detail.data} isOwner={isOwner} />
          <PartnerTerms detail={detail.data} isOwner={isOwner} />
          <PartnerChat detail={detail.data} isOwner={isOwner} />
        </>
      )}
    </section>
  )
}
