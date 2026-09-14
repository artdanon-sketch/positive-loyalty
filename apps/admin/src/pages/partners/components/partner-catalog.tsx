import { useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../../../shared/auth/auth-context'
import { fill } from '../../../shared/format/fill'
import { formatDate } from '../../../shared/format/format'
import { useT } from '../../../shared/i18n'
import { useCatalog, useInviteQuota } from '../hooks'
import { ALIVE, STATUS_LABELS, VERTICAL_LABELS } from '../labels'
import { InviteForm } from './invite-form'

/**
 * Каталог сети: с кем можно договориться. Дополняющие заведения — первыми
 * (порядок задаёт сервер). Размер базы — округлённо: точные цифры соседа
 * это его коммерческие данные.
 *
 * Если с заведением уже идёт разговор, вместо «Пригласить» — «Открыть»:
 * второе приглашение сервер всё равно не пропустит, и кнопка, которая
 * заведомо откажет, хуже ссылки на уже идущий разговор.
 *
 * По той же причине приостановленному кнопок «Пригласить» нет вовсе — только
 * объяснение. На охлаждении кнопки остаются, и каталог говорит, до какого числа
 * приглашение одно в день (docs/07, раздел 6.2).
 */
export function PartnerCatalogView(): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const catalog = useCatalog()
  const quota = useInviteQuota()
  const [inviting, setInviting] = useState<string | null>(null)
  const restriction = quota.data?.restriction ?? null

  if (catalog.isPending) {
    return (
      <div className="state" role="status">
        <p className="state__title">{t('common.loading')}</p>
      </div>
    )
  }

  if (catalog.isError) {
    return (
      <div className="state state--error" role="alert">
        <p className="state__title">{t('common.error.title')}</p>
        <p className="state__hint">{catalog.error.message}</p>
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            void catalog.refetch()
          }}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (catalog.data.items.length === 0) {
    return (
      <div className="state">
        <p className="state__title">{t('partners.catalog.empty')}</p>
      </div>
    )
  }

  return (
    <>
      {isOwner && quota.isSuccess ? (
        <p className="search__found" role="status">
          {t('partners.catalog.quota')}: {quota.data.freeLeft} / {quota.data.freeLimit}
        </p>
      ) : null}

      {isOwner && restriction?.kind === 'COOLING' ? (
        <p className="state__hint">
          {fill(t('partners.catalog.cooling'), { date: formatDate(restriction.until) })}
        </p>
      ) : null}

      {isOwner && restriction?.kind === 'SUSPENDED' ? (
        <p className="state__hint state__hint--error" role="alert">
          {t('partners.catalog.suspended')}
        </p>
      ) : null}

      <ul className="venue-grid">
        {catalog.data.items.map((venue) => {
          const current =
            venue.partnership !== null && ALIVE.includes(venue.partnership.status)
              ? venue.partnership
              : null

          return (
            <li key={venue.tenantId} className="venue-card">
              <p className="venue-card__name">{venue.brandName}</p>
              <p className="venue-card__meta">
                {t(VERTICAL_LABELS[venue.vertical])} ·{' '}
                {venue.guestsApprox === 0
                  ? t('partners.catalog.guestsFew')
                  : `~${venue.guestsApprox} ${t('partners.catalog.guests')}`}
              </p>

              {current !== null ? (
                <Link className="button" to={`/partners/${current.id}`}>
                  {t('partners.catalog.open')} · {t(STATUS_LABELS[current.status])}
                </Link>
              ) : !isOwner || restriction?.kind === 'SUSPENDED' ? null : inviting ===
                venue.tenantId ? (
                <InviteForm
                  venue={venue}
                  onCancel={() => {
                    setInviting(null)
                  }}
                />
              ) : (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    setInviting(venue.tenantId)
                  }}
                >
                  {t('partners.catalog.invite')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
