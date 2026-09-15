import { useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { AdminOfferCard, OfferStatus } from '@positive/contracts'

import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import type { TranslationKey } from '../../../shared/i18n'
import { useOfferTransition } from '../hooks'
import type { OfferAction } from '../hooks'

/**
 * Карточка акции: статус, название, условие словами и три цифры — выдано,
 * использовано, вернулось (docs/03, раздел 4). Завершённые приглушены.
 *
 * Партнёрская — с пометкой «партнёр: Студия», которая ведёт в партнёрство:
 * её условия меняются только там (docs/10, раздел 5.3).
 *
 * КНОПКИ — ТЕ, ЧТО ДАЛ СЕРВЕР. «Запустить», «Пауза», «Завершить» появляются
 * по `actions`: сервер знает роль, партнёрство и то, умеет ли касса эту акцию
 * считать. «Завершить» переспрашивает — вернуть завершённую акцию нельзя.
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
  const transition = useOfferTransition()
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const { actions } = offer

  const act = (action: OfferAction): void => {
    setConfirmingEnd(false)
    transition.mutate({ id: offer.id, action })
  }

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

      {actions.publish || actions.pause || actions.end ? (
        <div className="offer-card__actions" role="group" aria-label={t('offers.action.label')}>
          {confirmingEnd ? (
            <>
              <span className="offer-card__confirm">{t('offers.action.endConfirm')}</span>
              <button
                className="button button--danger"
                type="button"
                disabled={transition.isPending}
                onClick={() => {
                  act('end')
                }}
              >
                {t('offers.action.endYes')}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setConfirmingEnd(false)
                }}
              >
                {t('offers.action.cancel')}
              </button>
            </>
          ) : (
            <>
              {actions.publish ? (
                <button
                  className="button button--primary"
                  type="button"
                  disabled={transition.isPending}
                  onClick={() => {
                    act('publish')
                  }}
                >
                  {t('offers.action.publish')}
                </button>
              ) : null}
              {actions.pause ? (
                <button
                  className="button"
                  type="button"
                  disabled={transition.isPending}
                  onClick={() => {
                    act('pause')
                  }}
                >
                  {t('offers.action.pause')}
                </button>
              ) : null}
              {actions.end ? (
                <button
                  className="button button--danger"
                  type="button"
                  disabled={transition.isPending}
                  onClick={() => {
                    setConfirmingEnd(true)
                  }}
                >
                  {t('offers.action.end')}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {transition.isError ? (
        <p className="state__hint state__hint--error" role="alert">
          {transition.error.message}
        </p>
      ) : null}
    </article>
  )
}
