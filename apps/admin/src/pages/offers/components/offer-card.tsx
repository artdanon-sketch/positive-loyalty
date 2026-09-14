import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { AdminOfferCard, OfferStatus } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'

/**
 * Карточка акции: статус, название, условие словами и три цифры — выдано,
 * использовано, вернулось (docs/03, раздел 4). Завершённые приглушены.
 *
 * Партнёрская — с пометкой «партнёр: Студия», которая ведёт в партнёрство:
 * её условия меняются только там (docs/10, раздел 5.3).
 */

const STATUS_LABELS: Readonly<Record<OfferStatus, TranslationKey>> = {
  LIVE: 'offers.status.LIVE',
  SCHEDULED: 'offers.status.SCHEDULED',
  PAUSED: 'offers.status.PAUSED',
  DRAFT: 'offers.status.DRAFT',
  ENDED: 'offers.status.ENDED',
}

const STATUS_TONES: Readonly<Record<OfferStatus, string>> = {
  LIVE: 'chip--good',
  SCHEDULED: 'chip--neutral',
  PAUSED: 'chip--muted',
  DRAFT: 'chip--muted',
  ENDED: 'chip--muted',
}

export function OfferCard({ offer }: { offer: AdminOfferCard }): ReactElement {
  const t = useT()

  return (
    <article className={offer.status === 'ENDED' ? 'offer-card offer-card--ended' : 'offer-card'}>
      <p className="offer-card__meta">
        <span className={`chip ${STATUS_TONES[offer.status]}`}>
          {t(STATUS_LABELS[offer.status])}
        </span>
        {offer.partner === null ? null : (
          <Link
            className="chip chip--neutral offer-card__partner"
            to={`/partners/${offer.partner.partnershipId}`}
          >
            {fill(t('offers.partner'), { name: offer.partner.name ?? t('partner.fallbackName') })}
          </Link>
        )}
      </p>

      <h2 className="offer-card__title">{offer.title ?? t('offers.untitled')}</h2>

      {offer.howTo.length === 0 ? null : (
        <ul className="offer-card__how">
          {offer.howTo.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      )}

      <dl className="offer-card__stats">
        <div>
          <dt>{t('offers.stat.issued')}</dt>
          <dd>{offer.issued}</dd>
        </div>
        <div>
          <dt>{t('offers.stat.redeemed')}</dt>
          <dd>{offer.redeemed}</dd>
        </div>
        <div>
          <dt>{t('offers.stat.returned')}</dt>
          <dd>{offer.returned}</dd>
        </div>
      </dl>

      {offer.partner === null ? null : <p className="field__hint">{t('offers.partnerHint')}</p>}
    </article>
  )
}
